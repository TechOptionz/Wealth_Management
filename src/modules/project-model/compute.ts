/**
 * The pure calculation: `ModelInput` (+ optional scenario overrides) →
 * `ModelResult`. No storage, no clock, no React — the same input always yields
 * the same output, which is what lets a run be hashed, stored and replayed
 * (CAL05, DB03).
 *
 * Shape of the work, per basis (economic and gross):
 *   1. Cost lines → per-line position (I, A, R, U, EAC) via the engine, and
 *      dated cash: settled payments (actual months), approved unpaid and
 *      retention (their expected dates), remaining forecast (R + U) spread by
 *      the line's schedule after the cutoff (CF02–CF06, CAL06).
 *   2. Revenue events → receipts, restricted deposits, releases (YLD04).
 *   3. GST position by month → remittance or refund after the lag (CAL10).
 *   4. Month by month: recorded financing, then — in forecast months with the
 *      pilot policy — equity first, ranked debt second, interest through the
 *      facility ledger, bounded iteration for cash interest (FIN04, CAL17),
 *      uncovered need left visible as unfunded (CF08, F11).
 *   5. KPIs: profit and margins (CAL13), dated IRRs (CAL18/19), peaks (CAL20).
 */
import {
  DEFAULT_FORECAST_DAY,
  addMonthsToKey,
  allocateResidualToLast,
  applyFundingOrder,
  applyPpm,
  applyRepaymentOrder,
  costLinePosition,
  dateInMonth,
  developmentProfit,
  distributeEqualMonthly,
  distributeMilestoneLinked,
  distributeOneOff,
  grossFromNet,
  monthKeyOf,
  mulDivCents,
  peakBalance,
  recoverableTax,
  runFacilityLedger,
  runWaterfall,
  taxOnNet,
  upliftCents,
  xirr,
  FUNDING_MAX_ITERATIONS,
  FUNDING_TOLERANCE_CENTS,
  type DatedAmount,
  type DatedCashFlow,
  type FacilityMovementInput,
  type MonthKey,
  type TaxSettings,
  type TaxTreatment,
} from '@/shared/finance-engine';
import { addDays } from '@/shared/lib/dates';
import type { IsoDate } from '@/shared/types/common';
import type { TaxDisplayBasis } from '@/modules/projects/model';
import type {
  BasisView,
  CellContribution,
  GridRow,
  LinePosition,
  ModelInput,
  ModelKpis,
  ModelLineInput,
  ModelResult,
  ModelWarning,
  MonthTotals,
  ScenarioOverrides,
} from './model';

interface Ctx {
  readonly input: ModelInput;
  readonly overrides: ScenarioOverrides;
  readonly tax: TaxSettings;
  readonly firstForecastMonth: MonthKey;
  readonly warnings: ModelWarning[];
  /** When set, contributions for this cell are collected. */
  readonly collect?: { readonly rowId: string; readonly month: MonthKey; readonly basis: TaxDisplayBasis; readonly out: CellContribution[] };
}

interface LineBasisFigures {
  readonly approved: number;
  readonly approvedUnpaid: number;
  readonly unbilled: number;
  readonly uncommitted: number;
  readonly committed: number;
  readonly settled: number;
  readonly eac: number;
  readonly remainingCash: number;
  readonly baseline: number | null;
  readonly variance: number | null;
  readonly months: Record<MonthKey, number>;
}

interface LineComputation {
  readonly line: ModelLineInput;
  readonly economic: LineBasisFigures;
  readonly gross: LineBasisFigures;
  /** Recoverable input tax paid in cash, by month (for the GST position). */
  readonly inputCreditsByMonth: Record<MonthKey, number>;
}

const EMPTY_SUMMARY = { current: 0, expended: 0, baseline: null, variance: null, committed: 0, approvedUnpaid: 0, remainingForecast: 0 } as const;

function emptyMonths(months: readonly MonthKey[]): Record<MonthKey, number> {
  const record: Record<MonthKey, number> = {};
  for (const month of months) record[month] = 0;
  return record;
}

function addTo(record: Record<MonthKey, number>, month: MonthKey, cents: number): void {
  if (month in record) record[month] = (record[month] ?? 0) + cents;
}

function shiftDate(ctx: Ctx, date: IsoDate): IsoDate {
  const days = ctx.overrides.programmeShiftDays ?? 0;
  if (days === 0 || date <= ctx.input.cutoff) return date;
  return addDays(date, days);
}

/** Convert a tax-exclusive amount to gross and economic for a treatment. */
function bases(netCents: number, treatment: TaxTreatment, recoverablePpm: number, tax: TaxSettings): { gross: number; economic: number; tax: number; recoverable: number } {
  const taxCents = taxOnNet(netCents, treatment, tax);
  const recoverable = recoverableTax(taxCents, recoverablePpm);
  const gross = netCents + taxCents;
  return { gross, economic: gross - recoverable, tax: taxCents, recoverable };
}

function firstOpenDate(ctx: Ctx): IsoDate {
  return dateInMonth(ctx.firstForecastMonth, DEFAULT_FORECAST_DAY);
}

/** Forecast dates never land in a locked period (CF06). */
function openDate(ctx: Ctx, date: IsoDate, refId: string, shiftedCounter: { n: number }): IsoDate {
  const shifted = shiftDate(ctx, date);
  if (shifted > ctx.input.cutoff) return shifted;
  shiftedCounter.n += 1;
  return firstOpenDate(ctx);
}

function collect(ctx: Ctx, rowId: string, month: MonthKey, basis: TaxDisplayBasis, contribution: CellContribution): void {
  if (!ctx.collect) return;
  if (ctx.collect.rowId !== rowId || ctx.collect.month !== month || ctx.collect.basis !== basis) return;
  ctx.collect.out.push(contribution);
}

/** Distribute a remaining amount by the line's forecast method (CF04), after the cutoff. */
function scheduleRemaining(ctx: Ctx, line: ModelLineInput, cents: number, shiftedCounter: { n: number }): DatedAmount[] {
  if (cents === 0) return [];
  const schedule = line.schedule;
  const milestone = line.milestoneId ? ctx.input.milestones.find((m) => m.id === line.milestoneId) : undefined;
  let entries: DatedAmount[];
  try {
    switch (line.forecastMethod) {
      case 'one-off':
        entries = distributeOneOff(cents, schedule.oneOffDate ?? firstOpenDate(ctx));
        break;
      case 'equal-monthly': {
        const start = schedule.startMonth ?? ctx.firstForecastMonth;
        const months = Math.max(1, schedule.months ?? 1);
        // Only the months still open share the remaining amount; past months are gone.
        const open = Array.from({ length: months }, (_, index) => addMonthsToKey(start, index)).filter((m) => m > ctx.input.cutoffMonth);
        entries = open.length === 0 ? [{ date: firstOpenDate(ctx), cents }] : distributeEqualMonthly(cents, open[0] ?? start, open.length);
        break;
      }
      case 'weighted-monthly': {
        const weights = (schedule.weights ?? []).filter((w) => w.month > ctx.input.cutoffMonth);
        if (weights.length === 0) {
          entries = [{ date: firstOpenDate(ctx), cents }];
        } else {
          const total = weights.reduce((sum, w) => sum + w.weightPpm, 0);
          const parts = allocateResidualToLast(cents, weights.map((w) => w.weightPpm / total));
          entries = weights.map((w, index) => ({ date: dateInMonth(w.month, DEFAULT_FORECAST_DAY), cents: parts[index] ?? 0 }));
        }
        break;
      }
      case 'milestone-linked': {
        if (!milestone) {
          ctx.warnings.push({ code: 'missing-milestone', message: `${line.code} is milestone-linked but its milestone was not found; scheduled in the first open month.`, refId: line.id });
          entries = [{ date: firstOpenDate(ctx), cents }];
        } else {
          entries = distributeMilestoneLinked(cents, milestone.date, schedule.milestoneOffsetDays ?? 0);
        }
        break;
      }
      case 'manual': {
        const manual = schedule.manual ?? [];
        const open = manual.filter((entry) => shiftDate(ctx, entry.date) > ctx.input.cutoff && entry.cents > 0);
        const pool = open.length > 0 ? open : manual.filter((entry) => entry.cents > 0);
        if (pool.length === 0) {
          entries = [{ date: firstOpenDate(ctx), cents }];
        } else {
          const parts = allocateResidualToLast(cents, pool.map((entry) => entry.cents));
          entries = pool.map((entry, index) => ({ date: entry.date, cents: parts[index] ?? 0 }));
        }
        break;
      }
    }
  } catch {
    entries = [{ date: firstOpenDate(ctx), cents }];
  }
  return entries.map((entry) => ({ date: openDate(ctx, entry.date, line.id, shiftedCounter), cents: entry.cents }));
}

function upliftFor(ctx: Ctx, line: ModelLineInput): number {
  const uplift = ctx.overrides.costUplift;
  if (!uplift) return 0;
  const inCategory = !uplift.categoryIds || uplift.categoryIds.includes(line.categoryId);
  const inLines = !uplift.lineIds || uplift.lineIds.includes(line.id);
  if (!inCategory || !inLines) return 0;
  return uplift.ppm;
}

function computeLine(ctx: Ctx, line: ModelLineInput, linked: readonly { label: string; amountNetCents: number; triggerDate: IsoDate; basis: 'actual' | 'forecast' }[]): LineComputation {
  const months = ctx.input.months;
  const tax = ctx.tax;
  const shifted = { n: 0 };
  const uplift = upliftFor(ctx, line);

  // --- decomposition, tax-exclusive first ---------------------------------
  const committedNet = line.commitments.reduce((sum, c) => sum + c.revisedNetCents, 0);
  const linkedNet = linked.reduce((sum, o) => sum + o.amountNetCents, 0);
  const consumedDirectNet = line.approved
    .filter((a) => a.commitmentId === null && a.allowanceTreatment === 'consume-allowance')
    .reduce((sum, a) => sum + a.sign * a.netCents, 0);
  const uncommittedNet = Math.max(line.budgetNetCents - committedNet - linkedNet - consumedDirectNet, 0);

  const figures = (basis: TaxDisplayBasis): LineBasisFigures => {
    const conv = (netCents: number, treatment: TaxTreatment = line.taxTreatment, recoverable = line.recoverablePpm): number => {
      const b = bases(netCents, treatment, recoverable, tax);
      return basis === 'gross' ? b.gross : b.economic;
    };
    const upliftedU = uncommittedNet + (uplift ? upliftCents(uncommittedNet, uplift) : 0);
    const commitments = line.commitments.map((c) => {
      const unbilledNet = Math.max(c.revisedNetCents - c.invoicedNetCents, 0);
      const upliftedUnbilled = uplift && ctx.overrides.costUplift?.includeUnbilledCommitments ? unbilledNet + upliftCents(unbilledNet, uplift) : unbilledNet;
      return {
        id: c.id,
        revisedValueCents: conv(Math.min(c.invoicedNetCents, c.revisedNetCents), c.taxTreatment, c.recoverablePpm) + conv(upliftedUnbilled, c.taxTreatment, c.recoverablePpm),
        approvedInvoicedCents: conv(Math.min(c.invoicedNetCents, c.revisedNetCents), c.taxTreatment, c.recoverablePpm),
      };
    });
    // Invoiced beyond the commitment counts as approved cost but never as negative unbilled.
    const overInvoicedNet = line.commitments.reduce((sum, c) => sum + Math.max(c.invoicedNetCents - c.revisedNetCents, 0), 0);
    const directApproved = line.approved.filter((a) => a.commitmentId === null).reduce((sum, a) => sum + a.sign * (basis === 'gross' ? a.grossCents : a.economicCents), 0);
    const overInvoiced = overInvoicedNet === 0 ? 0 : conv(overInvoicedNet);
    const settledCash = line.settlements.reduce((sum, s) => sum + (basis === 'gross' ? s.cashCents : proportion(s.cashCents, s.invoiceEconomicCents, s.invoiceGrossCents)), 0);
    const nonCash = line.settlements.reduce((sum, s) => sum + (basis === 'gross' ? s.nonCashCents : proportion(s.nonCashCents, s.invoiceEconomicCents, s.invoiceGrossCents)), 0);
    const linkedTotal = conv(linkedNet);

    const position = costLinePosition({
      baselineCents: line.baselineNetCents === null ? null : conv(line.baselineNetCents),
      commitments,
      directSpendApprovedCents: directApproved + overInvoiced,
      settledCashCents: settledCash,
      nonCashSettledCents: nonCash,
      uncommittedAllowanceCents: conv(upliftedU) + linkedTotal,
    });

    // --- dated cash ---------------------------------------------------------
    const record = emptyMonths(months);
    const rowId = `line:${line.id}`;
    for (const settlement of line.settlements) {
      const cents = basis === 'gross' ? settlement.cashCents : proportion(settlement.cashCents, settlement.invoiceEconomicCents, settlement.invoiceGrossCents);
      const month = monthKeyOf(settlement.date);
      addTo(record, month, -cents);
      collect(ctx, rowId, month, basis, { source: 'settled-payment', label: `Payment · invoice ${settlement.invoiceId}`, cents: -cents, date: settlement.date, status: 'Paid', basis: 'actual', taxBasis: basis, editable: false, href: `invoices?invoice=${settlement.invoiceId}` });
    }
    for (const unpaid of line.unpaid) {
      const payable = (basis === 'gross' ? unpaid.grossCents : unpaid.economicCents) - (basis === 'gross' ? unpaid.retentionCents : proportion(unpaid.retentionCents, unpaid.economicCents, unpaid.grossCents));
      const date = openDate(ctx, unpaid.expectedPaymentDate, line.id, shifted);
      const month = monthKeyOf(date);
      addTo(record, month, -payable);
      collect(ctx, rowId, month, basis, { source: 'approved-unpaid', label: `Approved unpaid · invoice ${unpaid.invoiceId}`, cents: -payable, date, status: 'Approved · unpaid', basis: 'approved', taxBasis: basis, editable: false, href: `invoices?invoice=${unpaid.invoiceId}` });
      if (unpaid.retentionCents > 0) {
        const retention = basis === 'gross' ? unpaid.retentionCents : proportion(unpaid.retentionCents, unpaid.economicCents, unpaid.grossCents);
        const releaseDate = openDate(ctx, unpaid.retentionReleaseDate ?? ctx.input.completionDate, line.id, shifted);
        const releaseMonth = monthKeyOf(releaseDate);
        addTo(record, releaseMonth, -retention);
        collect(ctx, rowId, releaseMonth, basis, { source: 'retention', label: `Retention release · invoice ${unpaid.invoiceId}`, cents: -retention, date: releaseDate, status: 'Retained · unpaid', basis: 'approved', taxBasis: basis, editable: false, href: `invoices?invoice=${unpaid.invoiceId}` });
      }
    }
    for (const obligation of linked) {
      const cents = conv(obligation.amountNetCents);
      const date = openDate(ctx, obligation.triggerDate, line.id, shifted);
      const month = monthKeyOf(date);
      addTo(record, month, -cents);
      collect(ctx, rowId, month, basis, { source: 'linked-obligation', label: obligation.label, cents: -cents, date, status: obligation.basis === 'actual' ? 'Triggered' : 'Forecast · linked to sale', basis: 'forecast', taxBasis: basis, editable: false, href: 'yield' });
    }
    const remaining = position.unbilledCommitmentCents + position.uncommittedAllowanceCents - linkedTotal;
    for (const entry of scheduleRemaining(ctx, line, remaining, shifted)) {
      const month = monthKeyOf(entry.date);
      addTo(record, month, -entry.cents);
      collect(ctx, rowId, month, basis, { source: position.unbilledCommitmentCents > 0 ? 'unbilled-commitment' : 'forecast-allowance', label: `Remaining forecast · ${line.forecastMethod}`, cents: -entry.cents, date: entry.date, status: 'Forecast', basis: 'forecast', taxBasis: basis, editable: true, href: `costs/${line.categoryId}?line=${line.id}` });
    }

    return {
      approved: position.approvedCostCents,
      approvedUnpaid: position.approvedUnpaidCents,
      unbilled: position.unbilledCommitmentCents,
      uncommitted: position.uncommittedAllowanceCents,
      committed: position.committedCents,
      settled: position.settledCashCents,
      eac: position.expectedFinalCostCents,
      remainingCash: position.remainingCashCents,
      baseline: line.baselineNetCents === null ? null : conv(line.baselineNetCents),
      variance: position.varianceCents,
      months: record,
    };
  };

  const economic = figures('economic');
  const gross = figures('gross');
  if (shifted.n > 0) {
    ctx.warnings.push({ code: 'forecast-shifted', message: `${line.code}: ${shifted.n / 2} forecast amount(s) fell in a locked period and moved to the first open month.`, refId: line.id });
  }

  // Recoverable GST inside cash paid = gross − economic of each settlement, by month.
  const inputCreditsByMonth = emptyMonths(months);
  for (const settlement of line.settlements) {
    addTo(inputCreditsByMonth, monthKeyOf(settlement.date), settlement.cashCents - proportion(settlement.cashCents, settlement.invoiceEconomicCents, settlement.invoiceGrossCents));
  }
  // Forecast cash on standard lines carries recoverable GST too: gross − economic month by month.
  for (const month of months) {
    if (month <= ctx.input.cutoffMonth) continue;
    const grossOut = -(gross.months[month] ?? 0);
    const econOut = -(economic.months[month] ?? 0);
    addTo(inputCreditsByMonth, month, grossOut - econOut);
  }
  return { line, economic, gross, inputCreditsByMonth };
}

function proportion(part: number, numerator: number, denominator: number): number {
  if (denominator === 0 || numerator === denominator) return part;
  return mulDivCents(part, numerator, denominator);
}

interface FinancingMonth {
  equityContributions: number;
  debtDraws: number;
  cashInterest: number;
  capitalisedInterest: number;
  fees: number;
  principalRepayments: number;
  distributions: number;
  unfunded: number;
  debtClosing: number;
}

export interface ComputeOptions {
  readonly overrides?: ScenarioOverrides;
  readonly collect?: { readonly rowId: string; readonly month: MonthKey; readonly basis: TaxDisplayBasis };
}

export function computeModel(input: ModelInput, options: ComputeOptions = {}): { readonly result: ModelResult; readonly contributions: readonly CellContribution[] } {
  const overrides = options.overrides ?? {};
  const contributions: CellContribution[] = [];
  const ctx: Ctx = {
    input,
    overrides,
    tax: { standardRatePpm: overrides.taxRatePpm ?? input.taxRatePpm, marginSchemeEnabled: false },
    firstForecastMonth: addMonthsToKey(input.cutoffMonth, 1),
    warnings: [],
    ...(options.collect ? { collect: { ...options.collect, out: contributions } } : {}),
  };
  const months = input.months;

  // ---------------------------------------------------------------- costs
  const linkedByCode = new Map<string, { label: string; amountNetCents: number; triggerDate: IsoDate; basis: 'actual' | 'forecast' }[]>();
  for (const obligation of input.linkedObligations) {
    const list = linkedByCode.get(obligation.costLineCode) ?? [];
    list.push({ label: obligation.label, amountNetCents: obligation.amountNetCents, triggerDate: shiftDate(ctx, obligation.triggerDate), basis: obligation.basis });
    linkedByCode.set(obligation.costLineCode, list);
  }
  const postingLines = input.lines.filter((line) => line.rowType === 'posting');
  const computed = postingLines.map((line) => computeLine(ctx, line, linkedByCode.get(line.code) ?? []));

  // --------------------------------------------------------------- revenue
  const revenueByGroup = new Map<string, { receipts: Record<MonthKey, number>; held: Record<MonthKey, number>; released: Record<MonthKey, number>; netRevenue: Record<MonthKey, number> }>();
  const outputTaxByMonth = emptyMonths(months);
  const withholdingByMonth = emptyMonths(months);
  let grossRevenue = 0;
  let outputGst = 0;
  let contractedRevenue = 0;
  let uncontractedRevenue = 0;
  const priceUplift = overrides.unsoldPriceUpliftPpm ?? 0;
  for (const event of input.revenueEvents) {
    const group = revenueByGroup.get(event.groupId) ?? { receipts: emptyMonths(months), held: emptyMonths(months), released: emptyMonths(months), netRevenue: emptyMonths(months) };
    revenueByGroup.set(event.groupId, group);
    const uplifted = event.basis === 'forecast' && event.contractId === null && priceUplift !== 0;
    const factor = (cents: number): number => (uplifted ? cents + upliftCents(cents, priceUplift) : cents);
    const date = event.basis === 'actual' ? event.date : openDate(ctx, event.date, event.id, { n: 0 });
    const month = monthKeyOf(date);
    const gross = factor(event.grossCents);
    const tax = factor(event.taxCents);
    const rowId = `revenue:${event.groupId}`;
    switch (event.type) {
      case 'settlement':
      case 'other-income': {
        addTo(group.receipts, month, gross);
        addTo(group.netRevenue, month, factor(event.considerationCents) - tax);
        addTo(outputTaxByMonth, month, tax);
        addTo(withholdingByMonth, month, factor(event.withholdingCents));
        grossRevenue += factor(event.considerationCents);
        outputGst += tax;
        if (event.contractId) contractedRevenue += factor(event.considerationCents);
        else uncontractedRevenue += factor(event.considerationCents);
        collect(ctx, rowId, month, 'gross', { source: 'revenue-event', label: event.label, cents: gross, date, status: event.basis === 'actual' ? 'Received' : 'Forecast', basis: event.basis, taxBasis: 'gross', editable: event.basis === 'forecast', href: 'yield' });
        collect(ctx, rowId, month, 'economic', { source: 'revenue-event', label: event.label, cents: factor(event.considerationCents) - tax, date, status: event.basis === 'actual' ? 'Received' : 'Forecast', basis: event.basis, taxBasis: 'economic', editable: event.basis === 'forecast', href: 'yield' });
        break;
      }
      case 'deposit-held':
        addTo(group.held, month, gross);
        collect(ctx, `restricted:${event.groupId}`, month, 'gross', { source: 'revenue-event', label: event.label, cents: gross, date, status: 'Held in trust · restricted', basis: event.basis, taxBasis: 'gross', editable: false, href: 'yield' });
        break;
      case 'deposit-released':
        addTo(group.released, month, gross);
        addTo(group.held, month, -gross);
        collect(ctx, `release:${event.groupId}`, month, 'gross', { source: 'revenue-event', label: event.label, cents: gross, date, status: 'Released · unrestricted', basis: event.basis, taxBasis: 'gross', editable: false, href: 'yield' });
        break;
      case 'refund':
        addTo(group.held, month, -gross);
        addTo(group.receipts, month, -gross);
        break;
    }
  }

  // ------------------------------------------------------------ GST (CAL10)
  const lag = overrides.settlementLagMonths ?? input.settlementLagMonths;
  const gstPositionByMonth = emptyMonths(months);
  for (const month of months) {
    const inputCredits = computed.reduce((sum, c) => sum + (c.inputCreditsByMonth[month] ?? 0), 0);
    gstPositionByMonth[month] = (outputTaxByMonth[month] ?? 0) - (withholdingByMonth[month] ?? 0) - inputCredits;
  }
  const remittanceByMonth = emptyMonths(months);
  const refundByMonth = emptyMonths(months);
  for (const month of months) {
    const position = gstPositionByMonth[month] ?? 0;
    if (position === 0) continue;
    const settleMonth = addMonthsToKey(month, lag);
    if (!(settleMonth in remittanceByMonth)) continue;
    if (position > 0) addTo(remittanceByMonth, settleMonth, position);
    else addTo(refundByMonth, settleMonth, -position);
  }

  // ---------------------------------------------------- financing, monthly
  const developmentPaymentsGross = emptyMonths(months);
  const developmentPaymentsEconomic = emptyMonths(months);
  for (const c of computed) {
    for (const month of months) {
      addTo(developmentPaymentsGross, month, -(c.gross.months[month] ?? 0));
      addTo(developmentPaymentsEconomic, month, -(c.economic.months[month] ?? 0));
    }
  }
  const receiptsByMonth = emptyMonths(months);
  const heldByMonth = emptyMonths(months);
  const releasedByMonth = emptyMonths(months);
  for (const group of revenueByGroup.values()) {
    for (const month of months) {
      addTo(receiptsByMonth, month, group.receipts[month] ?? 0);
      addTo(heldByMonth, month, group.held[month] ?? 0);
      addTo(releasedByMonth, month, group.released[month] ?? 0);
    }
  }

  const financing = runFinancing(ctx, {
    receiptsByMonth,
    releasedByMonth,
    developmentPaymentsGross,
    remittanceByMonth,
    refundByMonth,
  });

  // ------------------------------------------------------------- totals
  const buildTotals = (basis: TaxDisplayBasis): MonthTotals[] => {
    let opening = input.openingCashCents;
    let restricted = input.openingRestrictedCents;
    const payments = basis === 'gross' ? developmentPaymentsGross : developmentPaymentsEconomic;
    return months.map((month) => {
      const f = financing.months[month] ?? emptyFinancing();
      restricted += heldByMonth[month] ?? 0;
      const closing =
        opening +
        (receiptsByMonth[month] ?? 0) +
        (releasedByMonth[month] ?? 0) +
        (refundByMonth[month] ?? 0) +
        f.equityContributions +
        f.debtDraws -
        (payments[month] ?? 0) -
        (remittanceByMonth[month] ?? 0) -
        f.cashInterest -
        f.fees -
        f.principalRepayments -
        f.distributions;
      const totals: MonthTotals = {
        month,
        actual: month <= input.cutoffMonth,
        receiptsCents: receiptsByMonth[month] ?? 0,
        depositsHeldCents: heldByMonth[month] ?? 0,
        depositsReleasedCents: releasedByMonth[month] ?? 0,
        developmentPaymentsCents: payments[month] ?? 0,
        taxRemittanceCents: remittanceByMonth[month] ?? 0,
        taxRefundCents: refundByMonth[month] ?? 0,
        equityContributionsCents: f.equityContributions,
        debtDrawsCents: f.debtDraws,
        cashInterestCents: f.cashInterest,
        capitalisedInterestCents: f.capitalisedInterest,
        feesCents: f.fees,
        principalRepaymentsCents: f.principalRepayments,
        distributionsCents: f.distributions,
        unfundedCents: f.unfunded,
        openingCashCents: opening,
        closingCashCents: closing,
        restrictedClosingCents: restricted,
        debtClosingCents: f.debtClosing,
        equityOutstandingCents: financing.equityOutstandingByMonth[month] ?? 0,
      };
      opening = closing;
      return totals;
    });
  };

  const buildRows = (basis: TaxDisplayBasis, totals: readonly MonthTotals[]): GridRow[] => {
    const rows: GridRow[] = [];
    const sumRecords = (records: readonly Record<MonthKey, number>[]): Record<MonthKey, number> => {
      const out = emptyMonths(months);
      for (const record of records) for (const month of months) addTo(out, month, record[month] ?? 0);
      return out;
    };
    const totalOf = (record: Record<MonthKey, number>): number => months.reduce((sum, month) => sum + (record[month] ?? 0), 0);
    const expendedOf = (record: Record<MonthKey, number>): number => months.filter((m) => m <= input.cutoffMonth).reduce((sum, month) => sum + (record[month] ?? 0), 0);

    // Revenue
    const groupRows: GridRow[] = [];
    for (const group of [...input.revenueGroups].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const figures = revenueByGroup.get(group.id);
      const record = basis === 'gross' ? (figures?.receipts ?? emptyMonths(months)) : (figures?.netRevenue ?? emptyMonths(months));
      groupRows.push({
        id: `revenue:${group.id}`,
        section: 'revenue',
        kind: 'posting',
        level: 1,
        label: basis === 'gross' ? `${group.name} · settlements & income (cash)` : `${group.name} · net revenue`,
        code: group.code,
        refId: group.id,
        months: record,
        summary: { ...EMPTY_SUMMARY, current: totalOf(record), expended: expendedOf(record) },
        posting: true,
      });
      if (basis === 'gross') {
        const released = figures?.released ?? emptyMonths(months);
        if (totalOf(released) !== 0) {
          groupRows.push({ id: `release:${group.id}`, section: 'revenue', kind: 'posting', level: 1, label: `${group.name} · deposits released to project`, code: group.code, refId: group.id, months: released, summary: { ...EMPTY_SUMMARY, current: totalOf(released), expended: expendedOf(released) }, posting: true });
        }
      }
    }
    const revenueTotal = sumRecords(groupRows.map((row) => row.months));
    rows.push({ id: 'revenue', section: 'revenue', kind: 'group', level: 0, label: 'Revenue', months: revenueTotal, summary: { ...EMPTY_SUMMARY, current: totalOf(revenueTotal), expended: expendedOf(revenueTotal) }, posting: false });
    rows.push(...groupRows);

    if (basis === 'gross') {
      const heldRows: GridRow[] = [];
      for (const group of input.revenueGroups) {
        const held = revenueByGroup.get(group.id)?.held ?? emptyMonths(months);
        if (totalOf(held) === 0 && months.every((m) => (held[m] ?? 0) === 0)) continue;
        heldRows.push({ id: `restricted:${group.id}`, section: 'restricted', kind: 'posting', level: 1, label: `${group.name} · deposits held in trust (restricted)`, refId: group.id, months: held, summary: { ...EMPTY_SUMMARY, current: totalOf(held), expended: expendedOf(held) }, posting: false });
      }
      if (heldRows.length > 0) {
        rows.push({ id: 'restricted', section: 'restricted', kind: 'group', level: 0, label: 'Restricted trust movements (memo · not project cash until released)', months: sumRecords(heldRows.map((r) => r.months)), summary: EMPTY_SUMMARY, posting: false });
        rows.push(...heldRows);
      }
    }

    // Costs
    const costRows: GridRow[] = [];
    const lineFigures = new Map(computed.map((c) => [c.line.id, basis === 'gross' ? c.gross : c.economic]));
    for (const category of [...input.categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const lines = [...input.lines].filter((line) => line.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder);
      if (lines.length === 0) continue;
      const lineRows: GridRow[] = [];
      const emit = (line: ModelLineInput, level: number): void => {
        if (line.rowType === 'summary') {
          const children = lines.filter((child) => child.parentLineId === line.id);
          const childFigures = children.map((child) => lineFigures.get(child.id)).filter((f): f is LineBasisFigures => f !== undefined);
          const record = sumRecords(childFigures.map((f) => f.months));
          lineRows.push({
            id: `line:${line.id}`,
            section: 'costs',
            kind: 'parent',
            level,
            label: line.title,
            code: line.code,
            refId: line.id,
            months: record,
            summary: {
              current: childFigures.reduce((s, f) => s + f.eac, 0),
              expended: childFigures.reduce((s, f) => s + f.settled, 0),
              baseline: childFigures.some((f) => f.baseline !== null) ? childFigures.reduce((s, f) => s + (f.baseline ?? 0), 0) : null,
              variance: childFigures.some((f) => f.variance !== null) ? childFigures.reduce((s, f) => s + (f.variance ?? 0), 0) : null,
              committed: childFigures.reduce((s, f) => s + f.committed, 0),
              approvedUnpaid: childFigures.reduce((s, f) => s + f.approvedUnpaid, 0),
              remainingForecast: childFigures.reduce((s, f) => s + f.unbilled + f.uncommitted, 0),
            },
            posting: false,
          });
          for (const child of children) emit(child, level + 1);
          return;
        }
        const f = lineFigures.get(line.id);
        if (!f) return;
        lineRows.push({
          id: `line:${line.id}`,
          section: 'costs',
          kind: 'posting',
          level,
          label: `${line.title}${line.active ? '' : ' (inactive)'}`,
          code: line.code,
          refId: line.id,
          months: f.months,
          summary: { current: f.eac, expended: f.settled, baseline: f.baseline, variance: f.variance, committed: f.committed, approvedUnpaid: f.approvedUnpaid, remainingForecast: f.unbilled + f.uncommitted },
          posting: true,
        });
      };
      for (const line of lines.filter((line) => !line.parentLineId || !lines.some((p) => p.id === line.parentLineId))) emit(line, 2);
      const postingRows = lineRows.filter((row) => row.posting);
      const categoryRecord = sumRecords(postingRows.map((row) => row.months));
      costRows.push({
        id: `category:${category.id}`,
        section: 'costs',
        kind: 'group',
        level: 1,
        label: category.name,
        code: category.code,
        refId: category.id,
        months: categoryRecord,
        summary: {
          current: postingRows.reduce((s, r) => s + r.summary.current, 0),
          expended: postingRows.reduce((s, r) => s + r.summary.expended, 0),
          baseline: postingRows.some((r) => r.summary.baseline !== null) ? postingRows.reduce((s, r) => s + (r.summary.baseline ?? 0), 0) : null,
          variance: postingRows.some((r) => r.summary.variance !== null) ? postingRows.reduce((s, r) => s + (r.summary.variance ?? 0), 0) : null,
          committed: postingRows.reduce((s, r) => s + r.summary.committed, 0),
          approvedUnpaid: postingRows.reduce((s, r) => s + r.summary.approvedUnpaid, 0),
          remainingForecast: postingRows.reduce((s, r) => s + r.summary.remainingForecast, 0),
        },
        posting: false,
      });
      costRows.push(...lineRows);
    }
    if (input.unmatchedPayments.length > 0) {
      const record = emptyMonths(months);
      for (const payment of input.unmatchedPayments) {
        addTo(record, monthKeyOf(payment.date), -payment.cents);
        collect(ctx, 'suspense', monthKeyOf(payment.date), basis, { source: 'suspense', label: `Unmatched payment · ${payment.reference}`, cents: -payment.cents, date: payment.date, status: 'Provisional · unreconciled', basis: 'actual', taxBasis: basis, editable: false, href: 'invoices?tab=payments' });
      }
      costRows.push({ id: 'suspense', section: 'costs', kind: 'posting', level: 1, label: 'Suspense · unmatched payments (provisional cost)', months: record, summary: { ...EMPTY_SUMMARY, current: totalOf(record), expended: expendedOf(record) }, posting: true });
    }
    const costPosting = costRows.filter((row) => row.posting);
    const costTotal = sumRecords(costPosting.map((row) => row.months));
    rows.push({
      id: 'costs',
      section: 'costs',
      kind: 'group',
      level: 0,
      label: 'Development costs',
      months: costTotal,
      summary: {
        current: costPosting.reduce((s, r) => s + r.summary.current, 0),
        expended: costPosting.reduce((s, r) => s + r.summary.expended, 0),
        baseline: costPosting.some((r) => r.summary.baseline !== null) ? costPosting.reduce((s, r) => s + (r.summary.baseline ?? 0), 0) : null,
        variance: costPosting.some((r) => r.summary.variance !== null) ? costPosting.reduce((s, r) => s + (r.summary.variance ?? 0), 0) : null,
        committed: costPosting.reduce((s, r) => s + r.summary.committed, 0),
        approvedUnpaid: costPosting.reduce((s, r) => s + r.summary.approvedUnpaid, 0),
        remainingForecast: costPosting.reduce((s, r) => s + r.summary.remainingForecast, 0),
      },
      posting: false,
    });
    rows.push(...costRows);

    // GST settlement
    const remitRecord = emptyMonths(months);
    const refundRecord = emptyMonths(months);
    for (const month of months) {
      remitRecord[month] = -(remittanceByMonth[month] ?? 0);
      refundRecord[month] = refundByMonth[month] ?? 0;
      if ((remittanceByMonth[month] ?? 0) !== 0) collect(ctx, 'gst:remit', month, basis, { source: 'gst', label: `GST remittance for ${addMonthsToKey(month, -lag)} position`, cents: -(remittanceByMonth[month] ?? 0), date: dateInMonth(month, 21), status: month <= input.cutoffMonth ? 'Actual' : 'Forecast', basis: month <= input.cutoffMonth ? 'actual' : 'forecast', taxBasis: 'cash', editable: false });
      if ((refundByMonth[month] ?? 0) !== 0) collect(ctx, 'gst:refund', month, basis, { source: 'gst', label: `GST refund for ${addMonthsToKey(month, -lag)} position`, cents: refundByMonth[month] ?? 0, date: dateInMonth(month, 21), status: month <= input.cutoffMonth ? 'Actual' : 'Forecast', basis: month <= input.cutoffMonth ? 'actual' : 'forecast', taxBasis: 'cash', editable: false });
    }
    const gstRows: GridRow[] = [
      { id: 'gst:remit', section: 'tax', kind: 'posting', level: 1, label: `GST remittance (lag ${lag} month${lag === 1 ? '' : 's'})`, months: remitRecord, summary: { ...EMPTY_SUMMARY, current: totalOf(remitRecord), expended: expendedOf(remitRecord) }, posting: true },
      { id: 'gst:refund', section: 'tax', kind: 'posting', level: 1, label: 'GST refund (input credits exceed output)', months: refundRecord, summary: { ...EMPTY_SUMMARY, current: totalOf(refundRecord), expended: expendedOf(refundRecord) }, posting: true },
    ];
    rows.push({ id: 'tax', section: 'tax', kind: 'group', level: 0, label: 'Indirect tax settlement (GST)', months: sumRecords(gstRows.map((r) => r.months)), summary: { ...EMPTY_SUMMARY, current: gstRows.reduce((s, r) => s + r.summary.current, 0), expended: gstRows.reduce((s, r) => s + r.summary.expended, 0) }, posting: false });
    rows.push(...gstRows);

    // Financing
    const finRows: GridRow[] = [];
    const finRecord = (pick: (t: MonthTotals) => number, sign: 1 | -1): Record<MonthKey, number> => {
      const record = emptyMonths(months);
      for (const t of totals) record[t.month] = sign * pick(t);
      return record;
    };
    const pushFin = (id: string, label: string, record: Record<MonthKey, number>, posting = true): void => {
      finRows.push({ id, section: 'financing', kind: 'posting', level: 1, label, months: record, summary: { ...EMPTY_SUMMARY, current: totalOf(record), expended: expendedOf(record) }, posting });
    };
    pushFin('fin:equity', 'Equity contributions', finRecord((t) => t.equityContributionsCents, 1));
    pushFin('fin:draws', 'Debt draws', finRecord((t) => t.debtDrawsCents, 1));
    pushFin('fin:interest', 'Cash interest', finRecord((t) => t.cashInterestCents, -1));
    pushFin('fin:capitalised', 'Capitalised interest (non-cash · added to principal)', finRecord((t) => t.capitalisedInterestCents, -1), false);
    pushFin('fin:fees', 'Facility fees', finRecord((t) => t.feesCents, -1));
    pushFin('fin:repayments', 'Principal repayments', finRecord((t) => t.principalRepaymentsCents, -1));
    pushFin('fin:distributions', 'Investor distributions', finRecord((t) => t.distributionsCents, -1));
    const finPosting = finRows.filter((r) => r.posting);
    rows.push({ id: 'financing', section: 'financing', kind: 'group', level: 0, label: 'Financing', months: sumRecords(finPosting.map((r) => r.months)), summary: { ...EMPTY_SUMMARY, current: finPosting.reduce((s, r) => s + r.summary.current, 0), expended: finPosting.reduce((s, r) => s + r.summary.expended, 0) }, posting: false });
    rows.push(...finRows);

    // Cash
    const closing = finRecord((t) => t.closingCashCents, 1);
    const unfunded = finRecord((t) => t.unfundedCents, 1);
    const restrictedClosing = finRecord((t) => t.restrictedClosingCents, 1);
    const debtClosing = finRecord((t) => t.debtClosingCents, 1);
    rows.push({ id: 'cash:closing', section: 'cash', kind: 'closing', level: 0, label: basis === 'gross' ? 'Closing unrestricted cash' : 'Closing cash (economic view · GST events included)', months: closing, summary: { ...EMPTY_SUMMARY, current: closing[months[months.length - 1] ?? ''] ?? 0 }, posting: false });
    rows.push({ id: 'cash:unfunded', section: 'cash', kind: 'plain', level: 1, label: 'Unfunded requirement (not covered by authorised equity or debt)', months: unfunded, summary: { ...EMPTY_SUMMARY, current: Math.max(...months.map((m) => unfunded[m] ?? 0), 0) }, posting: false });
    rows.push({ id: 'cash:restricted', section: 'cash', kind: 'plain', level: 1, label: 'Restricted trust balance (memo)', months: restrictedClosing, summary: { ...EMPTY_SUMMARY, current: restrictedClosing[months[months.length - 1] ?? ''] ?? 0 }, posting: false });
    rows.push({ id: 'cash:debt', section: 'cash', kind: 'plain', level: 1, label: 'Debt outstanding (memo)', months: debtClosing, summary: { ...EMPTY_SUMMARY, current: Math.max(...months.map((m) => debtClosing[m] ?? 0), 0) }, posting: false });
    return rows;
  };

  // ---------------------------------------------------------------- KPIs
  const positions: LinePosition[] = computed.map((c) => ({
    lineId: c.line.id,
    code: c.line.code,
    categoryId: c.line.categoryId,
    approvedCents: c.economic.approved,
    approvedUnpaidCents: c.gross.approvedUnpaid,
    unbilledCommitmentCents: c.economic.unbilled,
    uncommittedCents: c.economic.uncommitted,
    committedCents: c.economic.committed,
    settledCents: c.gross.settled,
    eacCents: c.economic.eac,
    remainingCashCents: c.gross.remainingCash,
    baselineCents: c.economic.baseline,
    varianceCents: c.economic.variance,
  }));

  const financeCategoryIds = new Set(input.categories.filter((c) => c.code === 'FIN').map((c) => c.id));
  const economicDevelopmentCost = computed.filter((c) => !financeCategoryIds.has(c.line.categoryId)).reduce((sum, c) => sum + c.economic.eac, 0);
  const economicFinanceLines = computed.filter((c) => financeCategoryIds.has(c.line.categoryId)).reduce((sum, c) => sum + c.economic.eac, 0);
  const grossCost = computed.reduce((sum, c) => sum + c.gross.eac, 0);
  const interestAndFees = Object.values(financing.months).reduce((sum, m) => sum + m.cashInterest + m.capitalisedInterest + m.fees, 0);
  const financeCost = interestAndFees + economicFinanceLines;
  const netRevenue = grossRevenue - outputGst;
  const profit = developmentProfit({ netRevenueCents: netRevenue, economicCostCents: economicDevelopmentCost, financeCostCents: financeCost });
  const baselineCost = computed.some((c) => c.economic.baseline !== null) ? computed.reduce((s, c) => s + (c.economic.baseline ?? 0), 0) : null;

  const grossTotals = buildTotals('gross');
  const economicTotals = buildTotals('economic');

  // Project IRR: unlevered dated flows (CAL18) — receipts less development payments and net GST.
  const projectFlows: DatedCashFlow[] = [];
  for (const t of grossTotals) {
    const date = dateInMonth(t.month, DEFAULT_FORECAST_DAY);
    const financeLinePayments = computed.filter((c) => financeCategoryIds.has(c.line.categoryId)).reduce((sum, c) => sum - (c.gross.months[t.month] ?? 0), 0);
    projectFlows.push({ date, cents: t.receiptsCents + t.depositsReleasedCents + t.taxRefundCents - (t.developmentPaymentsCents - financeLinePayments) - t.taxRemittanceCents });
  }
  const projectIrr = xirr(projectFlows);

  // Equity IRR: contributions negative, distributions positive, plus a modelled terminal distribution.
  const equityFlows: DatedCashFlow[] = [];
  for (const movement of input.equityMovements) {
    equityFlows.push({ date: movement.on, cents: movement.type === 'contribution' ? -movement.cents : movement.cents });
  }
  for (const generated of financing.generatedEquity) equityFlows.push({ date: generated.on, cents: -generated.cents });
  const lastMonth = months[months.length - 1];
  const lastTotals = grossTotals[grossTotals.length - 1];
  let terminalDistribution: ModelResult['terminalDistribution'] = null;
  if (lastMonth && lastTotals && input.waterfall?.published) {
    const available = lastTotals.closingCashCents - lastTotals.debtClosingCents;
    if (available > 0) {
      const outstandingByParticipant = new Map<string, number>();
      for (const p of input.participants) outstandingByParticipant.set(p.id, 0);
      for (const m of input.equityMovements) {
        if (m.type === 'contribution') outstandingByParticipant.set(m.participantId, (outstandingByParticipant.get(m.participantId) ?? 0) + m.cents);
        if (m.type === 'capital-return') outstandingByParticipant.set(m.participantId, (outstandingByParticipant.get(m.participantId) ?? 0) - m.cents);
      }
      for (const g of financing.generatedEquity) outstandingByParticipant.set(g.participantId, (outstandingByParticipant.get(g.participantId) ?? 0) + g.cents);
      const waterfall = runWaterfall({
        availableCashCents: available,
        requiredDebtCents: 0,
        reserveCents: 0,
        participants: input.participants.map((p) => ({
          id: p.id,
          outstandingCapitalCents: outstandingByParticipant.get(p.id) ?? 0,
          accruedPreferredCents: 0,
          residualShareWeight: p.residualShareWeight,
        })),
      });
      terminalDistribution = waterfall.allocations.map((a) => ({ participantId: a.participantId, cents: a.totalCents }));
      for (const allocation of waterfall.allocations) {
        if (allocation.totalCents > 0) equityFlows.push({ date: dateInMonth(lastMonth, 28), cents: allocation.totalCents });
      }
    }
  } else if (!input.waterfall?.published) {
    ctx.warnings.push({ code: 'no-published-waterfall', message: 'Equity IRR is not available: no published distribution agreement to model the terminal distribution.' });
  }
  const equityIrr = input.waterfall?.published ? xirr(equityFlows) : ({ available: false, reason: 'no-sign-change' } as const);

  const peakDebt = peakBalance(financing.debtMovements);
  const peakEquity = peakBalance([
    ...input.equityMovements.filter((m) => m.type === 'contribution' || m.type === 'capital-return').map((m) => ({ date: m.on, cents: m.type === 'contribution' ? m.cents : -m.cents })),
    ...financing.generatedEquity.map((g) => ({ date: g.on, cents: g.cents })),
  ]);
  const fundingGap = Math.max(0, ...grossTotals.map((t) => t.unfundedCents));
  let cumulative = 0;
  let peakRequirement = 0;
  for (const t of grossTotals) {
    cumulative += t.receiptsCents + t.depositsReleasedCents + t.taxRefundCents - t.developmentPaymentsCents - t.taxRemittanceCents - t.cashInterestCents - t.feesCents;
    if (-cumulative > peakRequirement) peakRequirement = -cumulative;
  }
  for (const t of grossTotals) {
    if (t.unfundedCents > 0) ctx.warnings.push({ code: 'unfunded', message: `${t.month}: ${(t.unfundedCents / 100).toLocaleString('en-AU')} not covered by authorised equity or debt.`, month: t.month });
    if (t.closingCashCents < 0 && t.actual) ctx.warnings.push({ code: 'negative-cash', message: `${t.month}: closing cash was negative.`, month: t.month });
  }
  if (input.unmatchedPayments.length > 0) {
    ctx.warnings.push({ code: 'suspense-items', message: `${input.unmatchedPayments.length} unmatched payment(s) sit in suspense; the project is not fully reconciled.` });
  }

  const kpis = (grossRevenueCents: number): ModelKpis => ({
    grossRevenueCents,
    outputGstCents: outputGst,
    netRevenueCents: netRevenue,
    economicCostCents: economicDevelopmentCost,
    grossCostCents: grossCost,
    financeCostCents: financeCost,
    profitCents: profit.profitCents,
    marginOnCost: profit.marginOnCost,
    marginOnRevenue: profit.marginOnRevenue,
    projectIrr,
    equityIrr,
    peakDebtCents: peakDebt.cents,
    peakDebtOn: peakDebt.on,
    peakEquityCents: peakEquity.cents,
    peakEquityOn: peakEquity.on,
    fundingGapCents: fundingGap,
    peakCashRequirementCents: peakRequirement,
    completionDate: shiftDate(ctx, input.completionDate),
    baselineCostCents: baselineCost,
    costVarianceCents: baselineCost === null ? null : economicDevelopmentCost + economicFinanceLines - baselineCost,
    contractedRevenueCents: contractedRevenue,
    uncontractedRevenueCents: uncontractedRevenue,
  });

  const economicView: BasisView = { rows: buildRows('economic', economicTotals), totals: economicTotals, kpis: kpis(grossRevenue) };
  const grossView: BasisView = { rows: buildRows('gross', grossTotals), totals: grossTotals, kpis: kpis(grossRevenue) };

  return {
    result: {
      months,
      cutoffMonth: input.cutoffMonth,
      economic: economicView,
      gross: grossView,
      positions,
      facilities: financing.facilities,
      generatedEquity: financing.generatedEquity,
      terminalDistribution,
      warnings: ctx.warnings,
      iterations: financing.iterations,
    },
    contributions,
  };
}

function emptyFinancing(): FinancingMonth {
  return { equityContributions: 0, debtDraws: 0, cashInterest: 0, capitalisedInterest: 0, fees: 0, principalRepayments: 0, distributions: 0, unfunded: 0, debtClosing: 0 };
}

interface FinancingInputs {
  readonly receiptsByMonth: Record<MonthKey, number>;
  readonly releasedByMonth: Record<MonthKey, number>;
  readonly developmentPaymentsGross: Record<MonthKey, number>;
  readonly remittanceByMonth: Record<MonthKey, number>;
  readonly refundByMonth: Record<MonthKey, number>;
}

interface FinancingResult {
  readonly months: Record<MonthKey, FinancingMonth>;
  readonly facilities: ModelResult['facilities'];
  readonly generatedEquity: { participantId: string; on: IsoDate; cents: number }[];
  readonly debtMovements: { date: IsoDate; cents: number }[];
  readonly equityOutstandingByMonth: Record<MonthKey, number>;
  readonly iterations: number;
}

/**
 * Month-by-month funding (FIN04, CAL17). Actual months use recorded movements
 * only. Forecast months cover any shortfall below the reserve from remaining
 * equity commitments first, then ranked debt within availability; excess cash
 * repays debt by repayment rank. Interest comes from the engine's ledger for
 * that month; cash interest feeds back into the month's need, so it iterates,
 * bounded, and reports non-convergence instead of publishing a guess.
 */
function runFinancing(ctx: Ctx, inputs: FinancingInputs): FinancingResult {
  const { input, overrides } = ctx;
  const months = input.months;
  const result: Record<MonthKey, FinancingMonth> = {};
  const equityOutstandingByMonth: Record<MonthKey, number> = {};
  const generatedEquity: { participantId: string; on: IsoDate; cents: number }[] = [];
  const debtMovements: { date: IsoDate; cents: number }[] = [];
  let iterationsTotal = 0;

  // Facility state carried month to month.
  const facilityState = input.facilities.map((facility) => {
    const rateSteps = overrides.facilityRatePpm?.[facility.id] !== undefined
      ? [...facility.terms.rateSteps, { from: dateInMonth(ctx.firstForecastMonth, 1), ratePpm: overrides.facilityRatePpm[facility.id] ?? 0 }]
      : facility.terms.rateSteps;
    return {
      facility,
      terms: { ...facility.terms, rateSteps },
      principal: 0,
      opened: false,
      rows: [] as ModelResult['facilities'][number]['months'][number][],
      generatedDraws: [] as { on: IsoDate; cents: number }[],
      generatedRepayments: [] as { on: IsoDate; cents: number }[],
    };
  });

  // Equity commitments remaining.
  const equityRemaining = new Map<string, number>();
  for (const participant of input.participants) equityRemaining.set(participant.id, participant.commitmentCents);
  for (const extra of overrides.additionalEquity ?? []) equityRemaining.set(extra.participantId, (equityRemaining.get(extra.participantId) ?? 0) + extra.cents);
  let equityOutstanding = 0;

  let cash = input.openingCashCents;

  for (const month of months) {
    const actual = month <= input.cutoffMonth;
    const monthStart = dateInMonth(month, 1);
    const monthEnd = dateInMonth(month, 31);
    const fundingDate = dateInMonth(month, DEFAULT_FORECAST_DAY);

    // Recorded equity movements this month (actuals always; planned only in forecast months).
    let equityContributions = 0;
    let distributions = 0;
    for (const movement of input.equityMovements) {
      if (monthKeyOf(movement.on) !== month) continue;
      if (movement.basis === 'planned' && actual) continue;
      if (movement.type === 'contribution') {
        equityContributions += movement.cents;
        equityRemaining.set(movement.participantId, (equityRemaining.get(movement.participantId) ?? 0) - movement.cents);
        equityOutstanding += movement.cents;
      } else {
        distributions += movement.cents;
        if (movement.type === 'capital-return') equityOutstanding -= movement.cents;
      }
    }

    // Recorded facility movements this month.
    const recordedByFacility = new Map<string, FacilityMovementInput[]>();
    let recordedDraws = 0;
    let recordedRepayments = 0;
    let fees = 0;
    for (const state of facilityState) {
      const list: FacilityMovementInput[] = [];
      for (const movement of state.facility.movements) {
        if (monthKeyOf(movement.on) !== month) continue;
        if (movement.basis === 'planned' && actual) continue;
        const on = movement.basis === 'planned' ? shiftDate(ctx, movement.on) : movement.on;
        if (monthKeyOf(on) !== month) continue;
        list.push({ on, kind: movement.kind, cents: movement.cents });
        if (movement.kind === 'draw') recordedDraws += movement.cents;
        else if (movement.kind === 'repayment') recordedRepayments += movement.cents;
        else if (movement.kind === 'fee') fees += movement.cents;
        else if (movement.cents >= 0) recordedDraws += movement.cents;
        else recordedRepayments += -movement.cents;
      }
      recordedByFacility.set(state.facility.id, list);
    }

    const operating =
      (inputs.receiptsByMonth[month] ?? 0) +
      (inputs.releasedByMonth[month] ?? 0) +
      (inputs.refundByMonth[month] ?? 0) -
      (inputs.developmentPaymentsGross[month] ?? 0) -
      (inputs.remittanceByMonth[month] ?? 0);

    let generatedDrawsByFacility = new Map<string, number>();
    let generatedRepaymentsByFacility = new Map<string, number>();
    let generatedEquityThisMonth: { participantId: string; cents: number }[] = [];
    let unfunded = 0;
    let cashInterest = 0;
    let capitalised = 0;
    let iterations = 0;

    const ledgerFor = (state: (typeof facilityState)[number], extra: FacilityMovementInput[]) => {
      const movements = [...(recordedByFacility.get(state.facility.id) ?? []), ...extra];
      // A carried balance opens the day before the month, so the ledger reports
      // it as the month's opening principal rather than as a day-one movement.
      const openingOn = state.opened ? addDays(monthStart, -1) : state.terms.openingOn;
      const openingPrincipal = state.opened ? state.principal : state.terms.openingPrincipalCents;
      return runFacilityLedger({ ...state.terms, openingPrincipalCents: openingPrincipal, openingOn }, movements, month, month);
    };

    const interestFor = (extraByFacility: Map<string, FacilityMovementInput[]>): { cash: number; capitalised: number } => {
      let cashSum = 0;
      let capSum = 0;
      for (const state of facilityState) {
        const ledger = ledgerFor(state, extraByFacility.get(state.facility.id) ?? []);
        const row = ledger.months[0];
        if (!row) continue;
        cashSum += row.cashInterestCents;
        capSum += row.capitalisedInterestCents;
      }
      return { cash: cashSum, capitalised: capSum };
    };

    if (actual || !input.autoFundForecast) {
      const interest = interestFor(new Map());
      cashInterest = interest.cash;
      capitalised = interest.capitalised;
      const closing = cash + operating + equityContributions + recordedDraws - recordedRepayments - cashInterest - fees - distributions;
      if (!actual && closing < input.minimumReserveCents) unfunded = input.minimumReserveCents - closing;
      cash = closing;
    } else {
      // Bounded fixed point: cash interest depends on this month's draws.
      // Start unconverged so the first pass always allocates funding (or repayments).
      let previousNeed = Number.POSITIVE_INFINITY;
      let need = 0;
      let converged = false;
      for (iterations = 1; iterations <= FUNDING_MAX_ITERATIONS; iterations += 1) {
        const extraByFacility = new Map<string, FacilityMovementInput[]>();
        for (const [id, cents] of generatedDrawsByFacility) extraByFacility.set(id, [{ on: fundingDate, kind: 'draw', cents }]);
        for (const [id, cents] of generatedRepaymentsByFacility) {
          const list = extraByFacility.get(id) ?? [];
          list.push({ on: fundingDate, kind: 'repayment', cents });
          extraByFacility.set(id, list);
        }
        const interest = interestFor(extraByFacility);
        cashInterest = interest.cash;
        capitalised = interest.capitalised;

        const preFunding = cash + operating + equityContributions + recordedDraws - recordedRepayments - cashInterest - fees - distributions;
        const shortfall = input.minimumReserveCents - preFunding;
        need = Math.max(shortfall, 0);
        if (Math.abs(need - previousNeed) <= FUNDING_TOLERANCE_CENTS) {
          converged = true;
          break;
        }
        previousNeed = need;
        generatedDrawsByFacility = new Map();
        generatedRepaymentsByFacility = new Map();
        generatedEquityThisMonth = [];
        if (need > 0) {
          const equitySources = input.participants
            .map((p) => ({ id: p.id, rank: p.rank, availableCents: Math.max(equityRemaining.get(p.id) ?? 0, 0) }))
            .filter((s) => s.availableCents > 0);
          const debtSources = facilityState
            .filter((s) => fundingDate >= s.facility.availableFrom && fundingDate <= s.facility.availableTo && fundingDate <= s.facility.maturityOn)
            .map((s) => ({ id: s.facility.id, rank: s.facility.drawRank, availableCents: Math.max(s.terms.limitCents - (s.opened ? s.principal : s.terms.openingPrincipalCents) - (recordedByFacility.get(s.facility.id) ?? []).reduce((sum, m) => sum + (m.kind === 'draw' ? m.cents : m.kind === 'repayment' ? -m.cents : m.kind === 'correction' ? m.cents : 0), 0), 0) }));
          const order = applyFundingOrder({ needCents: need, equitySources, debtSources });
          for (const draw of order.equityDraws) generatedEquityThisMonth.push({ participantId: draw.id, cents: draw.cents });
          for (const draw of order.debtDraws) generatedDrawsByFacility.set(draw.id, draw.cents);
          unfunded = order.unfundedCents;
        } else {
          unfunded = 0;
          const surplus = -shortfall;
          if (surplus > 0 && input.repayExcessCash) {
            const repay = applyRepaymentOrder({
              surplusCents: surplus,
              minimumReserveCents: input.minimumReserveCents,
              reserveHeldCents: input.minimumReserveCents,
              facilities: facilityState.map((s) => ({ id: s.facility.id, rank: s.facility.repayRank, outstandingCents: Math.max((s.opened ? s.principal : 0) + (recordedByFacility.get(s.facility.id) ?? []).reduce((sum, m) => sum + (m.kind === 'draw' ? m.cents : m.kind === 'repayment' ? -m.cents : m.kind === 'correction' ? m.cents : 0), 0), 0) })),
              repayExcess: true,
            });
            for (const repayment of repay.repayments) generatedRepaymentsByFacility.set(repayment.id, repayment.cents);
          }
        }
      }
      if (!converged) ctx.warnings.push({ code: 'nonconvergent', message: `${month}: funding did not converge within ${FUNDING_MAX_ITERATIONS} iterations; figures are marked non-convergent.`, month });
      const generatedEquityTotal = generatedEquityThisMonth.reduce((sum, g) => sum + g.cents, 0);
      const generatedDrawTotal = [...generatedDrawsByFacility.values()].reduce((sum, c) => sum + c, 0);
      const generatedRepayTotal = [...generatedRepaymentsByFacility.values()].reduce((sum, c) => sum + c, 0);
      for (const g of generatedEquityThisMonth) {
        equityRemaining.set(g.participantId, (equityRemaining.get(g.participantId) ?? 0) - g.cents);
        generatedEquity.push({ participantId: g.participantId, on: fundingDate, cents: g.cents });
        equityOutstanding += g.cents;
      }
      equityContributions += generatedEquityTotal;
      recordedDraws += generatedDrawTotal;
      recordedRepayments += generatedRepayTotal;
      cash = cash + operating + equityContributions + recordedDraws - recordedRepayments - cashInterest - fees - distributions;
    }
    iterationsTotal += iterations;

    // Commit the month to each facility's state from the engine's ledger.
    let debtClosing = 0;
    for (const state of facilityState) {
      const extra: FacilityMovementInput[] = [];
      const draw = generatedDrawsByFacility.get(state.facility.id);
      const repayment = generatedRepaymentsByFacility.get(state.facility.id);
      if (draw) {
        extra.push({ on: fundingDate, kind: 'draw', cents: draw });
        state.generatedDraws.push({ on: fundingDate, cents: draw });
      }
      if (repayment) {
        extra.push({ on: fundingDate, kind: 'repayment', cents: repayment });
        state.generatedRepayments.push({ on: fundingDate, cents: repayment });
      }
      const ledger = ledgerFor(state, extra);
      const row = ledger.months[0];
      if (!row) continue;
      if (row.drawsCents > 0) debtMovements.push({ date: fundingDate, cents: row.drawsCents });
      if (row.repaymentsCents > 0) debtMovements.push({ date: fundingDate, cents: -row.repaymentsCents });
      if (row.capitalisedInterestCents > 0) debtMovements.push({ date: monthEnd, cents: row.capitalisedInterestCents });
      if (row.breaches.length > 0) {
        for (const breach of row.breaches) ctx.warnings.push({ code: 'facility-breach', message: `${state.facility.name}: ${breach.kind} breach on ${breach.on}.`, month, refId: state.facility.id });
      }
      state.principal = row.closingPrincipalCents;
      if (!state.opened && (monthEnd >= state.terms.openingOn || row.closingPrincipalCents !== 0 || row.drawsCents !== 0)) state.opened = true;
      state.rows.push({
        month,
        openingCents: row.openingPrincipalCents,
        drawsCents: row.drawsCents,
        repaymentsCents: row.repaymentsCents,
        capitalisedCents: row.capitalisedInterestCents,
        cashInterestCents: row.cashInterestCents,
        feesCents: row.feesCents,
        closingCents: row.closingPrincipalCents,
        unusedCents: row.unusedCapacityCents,
        breaches: row.breaches.length,
      });
      debtClosing += row.closingPrincipalCents;
    }

    result[month] = {
      equityContributions,
      debtDraws: recordedDraws,
      cashInterest,
      capitalisedInterest: capitalised,
      fees,
      principalRepayments: recordedRepayments,
      distributions,
      unfunded,
      debtClosing,
    };
    equityOutstandingByMonth[month] = equityOutstanding;
  }

  return {
    months: result,
    facilities: facilityState.map((state) => ({
      id: state.facility.id,
      name: state.facility.name,
      months: state.rows,
      generatedDraws: state.generatedDraws,
      generatedRepayments: state.generatedRepayments,
    })),
    generatedEquity,
    debtMovements,
    equityOutstandingByMonth,
    iterations: iterationsTotal,
  };
}

/** Gross-up helper exported for tests and the drill-through view. */
export function grossOf(netCents: number, treatment: TaxTreatment, tax: TaxSettings): number {
  return grossFromNet(netCents, treatment, tax);
}

export { applyPpm };
