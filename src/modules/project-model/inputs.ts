/**
 * Gather one project's records into a `ModelInput`.
 *
 * This is the only place that knows which module owns which fact. Everything
 * below is a read; nothing here writes. Amounts are converted to plain cents
 * so the input can be hashed and stored as JSON.
 */
import { addMonthsToKey, monthKeyOf, monthKeysBetween, taxFromGross } from '@/shared/finance-engine';
import type { IsoDate, MilestoneId, ProjectId } from '@/shared/types/common';
import { projectsService } from '@/modules/projects/service';
import { budgetsService } from '@/modules/budgets/service';
import { commitmentsService } from '@/modules/commitments/service';
import { invoicesService } from '@/modules/invoices/service';
import { programmeService } from '@/modules/programme/service';
import { salesService } from '@/modules/sales/service';
import { fundingService } from '@/modules/funding/service';
import type {
  ModelFacilityInput,
  ModelInput,
  ModelLineInput,
  ModelRevenueEventInput,
} from './model';

export interface BuildInputOptions {
  readonly asOf?: IsoDate;
  /** Milestone dates to use instead of the recorded ones — the programme move preview (PRG03). */
  readonly milestoneDates?: ReadonlyMap<string, IsoDate>;
}

function cents(value: { readonly cents: number } | null | undefined): number {
  return value?.cents ?? 0;
}

export function buildModelInput(projectId: ProjectId, options: BuildInputOptions = {}): ModelInput {
  const project = projectsService.require(projectId);
  const policy = projectsService.policyFor(projectId);
  const startMonth = monthKeyOf(project.startDate);
  const months = monthKeysBetween(startMonth, addMonthsToKey(startMonth, Math.max(project.forecastHorizonMonths, 1) - 1));
  const cutoff = policy.actualsCutoff;
  const cutoffMonth = monthKeyOf(cutoff);
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);

  // Programme — dates, with any preview overrides applied.
  const baseResolver = programmeService.dateResolver(projectId);
  const resolveMilestone = (id: MilestoneId): IsoDate => options.milestoneDates?.get(id) ?? baseResolver(id);
  const milestones = programmeService.listMilestones(projectId).map((milestone) => ({
    id: milestone.id,
    name: milestone.name,
    date: resolveMilestone(milestone.id),
    kind: milestone.kind,
  }));
  const completionDate = milestones.reduce((latest, m) => (m.date > latest ? m.date : latest), project.expectedCompletion);

  // Budgets, commitments and invoices → cost lines.
  const budgets = budgetsService.currentBudgetByLine(projectId);
  const baseline = budgetsService.selectedBaseline(projectId);
  const commitmentsByLine = commitmentsService.allocationsByLine(projectId);
  const approvedByLine = invoicesService.approvedAllocationsByLine(projectId);
  const settledByLine = invoicesService.settledCashByLine(projectId);
  const unpaidByLine = invoicesService.approvedUnpaidByLine(projectId);

  const lines: ModelLineInput[] = budgetsService.listCostLines(projectId).map((line) => {
    const approved = approvedByLine.get(line.id) ?? [];
    const commitments = (commitmentsByLine.get(line.id) ?? []).map((allocation) => {
      const commitment = commitmentsService.requireCommitment(allocation.commitmentId);
      const invoicedNet = approved
        .filter((view) => view.commitmentId === allocation.commitmentId)
        .reduce((sum, view) => sum + view.sign * view.net.cents, 0);
      return {
        id: allocation.commitmentId,
        reference: allocation.reference,
        supplierName: allocation.supplierName,
        revisedNetCents: allocation.amount.cents,
        invoicedNetCents: invoicedNet,
        taxTreatment: commitment.taxTreatment,
        recoverablePpm: line.recoverablePpm,
      };
    });
    const approvedByInvoice = new Map<string, { gross: number; economic: number }>();
    for (const view of approved) {
      const entry = approvedByInvoice.get(view.invoiceId) ?? { gross: 0, economic: 0 };
      entry.gross += view.sign * view.gross.cents;
      entry.economic += view.sign * view.economic.cents;
      approvedByInvoice.set(view.invoiceId, entry);
    }
    return {
      id: line.id,
      code: line.code,
      title: line.title,
      categoryId: line.categoryId,
      rowType: line.rowType,
      parentLineId: line.parentLineId ?? null,
      sortOrder: line.sortOrder,
      active: line.active,
      isContingency: line.isContingency,
      taxTreatment: line.taxTreatment,
      recoverablePpm: line.recoverablePpm,
      budgetNetCents: cents(budgets.get(line.id)),
      baselineNetCents: baseline ? (budgetsService.baselineAmount(line.id, baseline)?.cents ?? null) : null,
      commitments,
      approved: approved.map((view) => ({
        invoiceId: view.invoiceId,
        number: view.number,
        supplierName: view.supplierName,
        sign: view.sign,
        commitmentId: view.commitmentId,
        allowanceTreatment: view.allowanceTreatment,
        netCents: view.net.cents,
        taxCents: view.tax.cents,
        grossCents: view.gross.cents,
        economicCents: view.economic.cents,
        expectedPaymentDate: view.expectedPaymentDate,
      })),
      settlements: (settledByLine.get(line.id) ?? []).map((settlement) => {
        const ratio = approvedByInvoice.get(settlement.invoiceId) ?? { gross: 0, economic: 0 };
        return {
          invoiceId: settlement.invoiceId,
          date: settlement.effectiveDate,
          cashCents: settlement.cash.cents,
          nonCashCents: settlement.nonCash.cents,
          invoiceGrossCents: ratio.gross,
          invoiceEconomicCents: ratio.economic,
        };
      }),
      unpaid: (unpaidByLine.get(line.id) ?? []).map((unpaid) => ({
        invoiceId: unpaid.invoiceId,
        expectedPaymentDate: unpaid.expectedPaymentDate,
        grossCents: unpaid.gross.cents,
        economicCents: unpaid.economic.cents,
        retentionCents: unpaid.retention.cents,
        ...(unpaid.retentionForecastReleaseDate ? { retentionReleaseDate: unpaid.retentionForecastReleaseDate } : {}),
      })),
      forecastMethod: line.forecastMethod,
      schedule: {
        ...(line.schedule.oneOffDate ? { oneOffDate: line.schedule.oneOffDate } : {}),
        ...(line.schedule.startMonth ? { startMonth: line.schedule.startMonth } : {}),
        ...(line.schedule.months !== undefined ? { months: line.schedule.months } : {}),
        ...(line.schedule.weights ? { weights: line.schedule.weights } : {}),
        ...(line.schedule.milestoneOffsetDays !== undefined ? { milestoneOffsetDays: line.schedule.milestoneOffsetDays } : {}),
        ...(line.schedule.manual ? { manual: line.schedule.manual } : {}),
      },
      milestoneId: line.milestoneId ?? null,
    };
  });

  // Sales → revenue events and linked commission obligations.
  const units = new Map(salesService.listUnits(projectId).map((unit) => [unit.id, unit]));
  const contracts = new Map(salesService.listContracts(projectId).map((contract) => [contract.id, contract]));
  const groupOf = (unitId: string | undefined, fallback: string): string => (unitId ? (units.get(unitId as never)?.groupId ?? fallback) : fallback);
  const groups = salesService.listGroups(projectId);
  const otherGroup = groups.find((g) => g.code === 'OTH')?.id ?? groups[0]?.id ?? 'other';

  const toEvent = (event: ReturnType<typeof salesService.actualRevenueEvents>[number]): ModelRevenueEventInput => {
    const contract = event.contractId ? contracts.get(event.contractId) : undefined;
    const unit = event.unitId ? units.get(event.unitId) : undefined;
    let consideration = event.gross.cents;
    let withholding = 0;
    if (event.type === 'settlement') {
      const recorded = (event as { readonly withholding?: { readonly cents: number } }).withholding;
      if (contract) {
        consideration = contract.consideration.cents + contract.adjustments.cents;
        withholding = recorded?.cents ?? contract.withholding.cents;
      } else if (unit) {
        consideration = unit.forecastPrice.cents;
        withholding = recorded?.cents ?? (unit.taxTreatment === 'standard-gst' ? taxFromGross(consideration, 'standard-gst', { standardRatePpm: policy.tax.standardRatePpm, marginSchemeEnabled: false }) : 0);
      }
    }
    const label = event.note ?? (unit ? `${unit.code} · ${event.type}` : event.type);
    return {
      id: event.id,
      groupId: event.otherIncomeId ? otherGroup : groupOf(event.unitId, otherGroup),
      label,
      type: event.type,
      date: event.date,
      grossCents: event.gross.cents,
      taxCents: event.tax.cents,
      withholdingCents: withholding,
      considerationCents: consideration,
      restricted: event.restricted,
      basis: event.basis,
      contractId: event.contractId ?? null,
    };
  };
  const revenueEvents = [
    ...salesService.actualRevenueEvents(projectId).map(toEvent),
    ...salesService.forecastRevenueEvents(projectId, resolveMilestone).map(toEvent),
  ];
  const linkedObligations = salesService.commissionObligations(projectId).map((obligation) => ({
    costLineCode: obligation.costLineCode,
    contractId: obligation.contractId,
    label: `Sales commission · ${obligation.unitCode}`,
    amountNetCents: obligation.amount.cents,
    triggerDate: obligation.triggerDate,
    basis: obligation.basis,
  }));

  // Funding.
  const facilities: ModelFacilityInput[] = fundingService.listFacilities(projectId).map((facility) => ({
    id: facility.id,
    name: facility.name,
    terms: fundingService.facilityTerms(facility),
    drawRank: facility.drawRank,
    repayRank: facility.repaymentRank,
    availableFrom: facility.availableFrom,
    availableTo: facility.availableTo,
    maturityOn: facility.maturityOn,
    movements: fundingService.listMovements(facility.id).map((movement) => ({
      on: movement.on,
      kind: movement.kind,
      cents: movement.amount.cents,
      basis: movement.basis,
    })),
  }));
  const participants = [...fundingService.listParticipants(projectId)]
    .sort((a, b) => (a.class === 'sponsor' ? 0 : 1) - (b.class === 'sponsor' ? 0 : 1) || b.participationWeight - a.participationWeight || a.id.localeCompare(b.id))
    .map((participant, index) => ({
      id: participant.id,
      name: participant.name,
      commitmentCents: participant.commitment.cents,
      rank: index + 1,
      residualShareWeight: participant.residualShareWeight,
      preferredRatePpm: participant.preferredRatePpm,
    }));
  const equityMovements = fundingService.listEquityMovements(projectId).map((movement) => ({
    participantId: movement.participantId,
    on: movement.on,
    type: movement.type,
    cents: movement.amount.cents,
    basis: movement.basis,
  }));
  const waterfall = fundingService.currentWaterfall(projectId);

  return {
    projectId,
    code: project.code,
    name: project.name,
    asOf,
    startMonth,
    months,
    cutoff,
    cutoffMonth,
    modelRevision: project.modelRevision,
    policyVersion: policy.version,
    openingCashCents: project.openingCash.cents,
    openingRestrictedCents: project.openingRestrictedCash.cents,
    taxRatePpm: policy.tax.standardRatePpm,
    settlementLagMonths: policy.tax.settlementLagMonths,
    minimumReserveCents: policy.funding.minimumReserve.cents,
    repayExcessCash: policy.funding.repayExcessCash,
    autoFundForecast: policy.funding.autoFundForecast,
    defaultBasis: policy.tax.displayBasis,
    categories: budgetsService.listCategories(projectId).map((category) => ({ id: category.id, code: category.code, name: category.name, sortOrder: category.sortOrder })),
    lines,
    revenueGroups: groups.map((group) => ({ id: group.id, code: group.code, name: group.name, sortOrder: group.sortOrder })),
    revenueEvents,
    linkedObligations,
    facilities,
    participants,
    equityMovements,
    milestones,
    completionDate,
    waterfall: waterfall ? { published: waterfall.state === 'published', reserveCents: waterfall.reserve.cents, versionLabel: `v${waterfall.version}` } : null,
    unmatchedPayments: invoicesService.unmatchedPayments(projectId).map((payment) => ({
      paymentId: payment.paymentId,
      date: payment.effectiveDate,
      cents: payment.amount.cents,
      reference: payment.reference,
    })),
  };
}
