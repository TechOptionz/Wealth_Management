/**
 * Dashboard business logic (FR-09).
 *
 * Implements the two headline rules:
 *  - **BR-01** net worth = included asset interests − included liabilities, at a
 *    stated as-of date.
 *  - **BR-02** look-through consolidation: every asset is counted once, at the
 *    owning entity's share, and an entity's equity is never added on top of the
 *    assets it already holds.
 */
import { endOfMonth, formatMonthShort, recentMonths, startOfMonth } from '@/shared/lib/dates';
import { addMoney, money, scaleMoney, subtractMoney, sumMoney, type Money } from '@/shared/lib/money';
import { UPCOMING_WINDOW_DAYS } from '@/shared/config/app-config';
import type { EntityId, IsoDate } from '@/shared/types/common';
import { entitiesService, type EntityHoldings } from '@/modules/entities/service';
import { propertiesService } from '@/modules/properties/service';
import { loansService } from '@/modules/loans/service';
import { loansRepository } from '@/modules/loans/repository';
import { leasesService } from '@/modules/leases/service';
import { obligationsService } from '@/modules/obligations/service';
import { reconciliationService, cashFlowService } from '@/modules/reconciliation/service';
import { dashboardRepository } from './repository';
import { scenarioInputs } from './scenarios';
import { expensesService } from '@/modules/expenses/service';
import { leasesRepository } from '@/modules/leases/repository';
import type {
  AttentionItem,
  CashFlowPoint,
  FinancialPosition,
  DashboardScope,
  NetWorthBreakdown,
  OwnershipPosition,
  ScopeOption,
  SnapshotMovement,
} from './model';

/** Months shown on the cash-flow chart. */
const CASH_FLOW_MONTHS = 6;

export const dashboardService = {
  /**
   * Entities a reader may scope the dashboard to.
   *
   * Only consolidated entities are offered: a manual-summary entity contributes
   * nothing to the totals, so scoping to it would render a screen of zeros that
   * reads as "this entity owns nothing" rather than "this entity is not counted".
   */
  scopeOptions(): readonly ScopeOption[] {
    return entitiesService
      .consolidatedEntityIds()
      .map((entityId) => ({ entityId, entityName: entitiesService.nameOf(entityId) }));
  },

  /**
   * Turn an untrusted `entityId` into a scope.
   *
   * An absent, unknown or non-consolidated id resolves to `null` — the whole
   * portfolio — so a stale bookmark degrades to the consolidated view instead
   * of an error page.
   */
  resolveScope(rawEntityId: string | undefined): DashboardScope | null {
    if (!rawEntityId) return null;
    return dashboardService.scopeOptions().find((option) => option.entityId === rawEntityId) ?? null;
  },

  /**
   * Total value of assets the portfolio has an interest in.
   *
   * Each property contributes `valuation × the share held by consolidated
   * entities`. An unallocated share is simply not counted — the platform never
   * assumes ownership it has not been told about.
   *
   * With `entityId`, the figure is that entity's attributed position (BR-02):
   * its share of each property plus its share of any receivable it lent.
   */
  totalAssets(asOf: IsoDate, entityId?: EntityId): Money {
    if (entityId) return dashboardService.positionOf(asOf, entityId).assets;

    const consolidated = new Set<string>(entitiesService.consolidatedEntityIds());

    const propertyValue = propertiesService.list().map((property) => {
      const status = propertiesService.valuationStatus(property.id, asOf);
      if (!status.valuation) return money(0);

      const includedShare = entitiesService
        .ownersOf(property.id, asOf)
        .filter((claim) => consolidated.has(claim.ownerEntityId))
        .reduce((total, claim) => total + claim.share, 0);

      return scaleMoney(status.valuation.amount, includedShare);
    });

    // Money lent out is an asset, never a reduction of debt (FR-11).
    return addMoney(sumMoney(propertyValue), loansService.totalReceivables());
  },

  /** All debt, or with `entityId` the debt attributed to that borrower (BR-02). */
  totalLiabilities(asOf?: IsoDate, entityId?: EntityId): Money {
    if (asOf && entityId) return dashboardService.positionOf(asOf, entityId).liabilities;
    return loansService.totalDebt();
  },

  /**
   * BR-01.
   *
   * Scoped to an entity, movement is `null`: snapshots record portfolio totals
   * only, and comparing one entity against the whole portfolio's snapshot would
   * report a collapse that never happened.
   */
  netWorth(asOf: IsoDate, entityId?: EntityId): NetWorthBreakdown {
    const assets = dashboardService.totalAssets(asOf, entityId);
    const liabilities = dashboardService.totalLiabilities(asOf, entityId);
    const netWorth = subtractMoney(assets, liabilities);

    const snapshot = entityId ? undefined : dashboardRepository.latestSnapshot(asOf);
    const movement: SnapshotMovement | null = snapshot
      ? {
          snapshotLabel: snapshot.label,
          netWorthChangeRatio:
            snapshot.netWorth.cents === 0 ? 0 : (netWorth.cents - snapshot.netWorth.cents) / snapshot.netWorth.cents,
          liabilitiesChange: subtractMoney(liabilities, snapshot.liabilities),
        }
      : null;

    return {
      asOf,
      assets,
      liabilities,
      netWorth,
      movement,
      staleValuationCount: propertiesService
        .staleValuationProperties(asOf)
        .filter(
          (property) =>
            !entityId ||
            entitiesService.ownersOf(property.id, asOf).some((claim) => claim.ownerEntityId === entityId),
        ).length,
    };
  },

  /** One entity's attributed position; zeros when it holds nothing. */
  positionOf(asOf: IsoDate, entityId: EntityId): OwnershipPosition {
    return (
      dashboardService.ownershipPositions(asOf).find((position) => position.entityId === entityId) ?? {
        entityId,
        entityName: entitiesService.nameOf(entityId),
        assets: money(0),
        liabilities: money(0),
        net: money(0),
        shareOfTotal: 0,
      }
    );
  },

  /**
   * An entity's property balance sheet (FR-01, BR-02).
   *
   * The arithmetic lives in the entities module; this supplies the valuations
   * and facilities it cannot import. A pool spreads across its properties only
   * under an equal-split policy — otherwise the debt is attributed to the
   * borrower but to no single property, as `loansService.debtForProperty` does.
   */
  entityHoldings(entityId: EntityId, asOf: IsoDate): EntityHoldings {
    return entitiesService.entityHoldings(entityId, asOf, {
      propertyNameOf: (propertyId) => propertiesService.require(propertyId).name,
      valuationOf: (propertyId, on) => propertiesService.valuationStatus(propertyId, on).valuation?.amount ?? null,
      facilities: loansRepository.listLiabilities().map((loan) => ({
        borrowerEntityIds: loan.borrowerEntityIds,
        balance: loan.balance,
        security:
          loan.security.kind === 'pool' && loan.allocationPolicy?.kind !== 'equal-split'
            ? []
            : loan.security.propertyIds.map((propertyId) => ({ propertyId, weight: 1 })),
      })),
    });
  },

  /**
   * Net position per consolidated entity (BR-02).
   *
   * Assets are attributed by ownership share. Debt is attributed to the entities
   * named as borrowers, split evenly when a facility has several. Each property
   * and each facility therefore appears exactly once across all positions.
   *
   * With `entityId`, only that entity's row is returned. `shareOfTotal` stays
   * relative to the whole portfolio, so the bar still answers "how much of the
   * family's net worth sits here".
   */
  ownershipPositions(asOf: IsoDate, entityId?: EntityId): readonly OwnershipPosition[] {
    const consolidated = entitiesService.consolidatedEntityIds();
    const assetsByEntity = new Map<EntityId, Money>();
    const liabilitiesByEntity = new Map<EntityId, Money>();

    const bump = (map: Map<EntityId, Money>, id: EntityId, amount: Money): void => {
      map.set(id, addMoney(map.get(id) ?? money(0), amount));
    };

    propertiesService.list().forEach((property) => {
      const status = propertiesService.valuationStatus(property.id, asOf);
      if (!status.valuation) return;
      entitiesService.ownersOf(property.id, asOf).forEach((claim) => {
        if (!consolidated.includes(claim.ownerEntityId)) return;
        bump(assetsByEntity, claim.ownerEntityId, scaleMoney(status.valuation!.amount, claim.share));
      });
    });

    loansRepository.list().forEach((loan) => {
      const holders = loan.borrowerEntityIds.filter((id) => consolidated.includes(id));
      if (holders.length === 0) return;
      const perHolder = scaleMoney(loan.balance, 1 / holders.length);
      holders.forEach((id) => {
        // A receivable is held as an asset by the lender; a liability is owed.
        bump(loan.direction === 'receivable' ? assetsByEntity : liabilitiesByEntity, id, perHolder);
      });
    });

    const positions = consolidated.map((entityId) => {
      const assets = assetsByEntity.get(entityId) ?? money(0);
      const liabilities = liabilitiesByEntity.get(entityId) ?? money(0);
      return {
        entityId,
        entityName: entitiesService.nameOf(entityId),
        assets,
        liabilities,
        net: subtractMoney(assets, liabilities),
        shareOfTotal: 0,
      };
    });

    const total = sumMoney(positions.map((position) => position.net));
    return positions
      .filter((position) => position.assets.cents !== 0 || position.liabilities.cents !== 0)
      .map((position) => ({
        ...position,
        shareOfTotal: total.cents === 0 ? 0 : position.net.cents / total.cents,
      }))
      .filter((position) => !entityId || position.entityId === entityId)
      .sort((a, b) => b.net.cents - a.net.cents);
  },

  /**
   * Six months of posted cash movement for the chart (BR-03).
   *
   * Anchored on the latest **posted** month, not the month containing `asOf`.
   * Anchoring on the current month would append an empty bar for a period that
   * has not been reconciled yet, which reads as a collapse in receipts rather
   * than as an absence of data.
   */
  cashFlow(asOf: IsoDate, months = CASH_FLOW_MONTHS): readonly CashFlowPoint[] {
    const posted = cashFlowService.recentMonths(asOf, months);
    const byMonth = new Map(posted.map((entry) => [entry.month, entry]));

    const anchor = posted[posted.length - 1]?.month ?? startOfMonth(asOf);
    return recentMonths(anchor, months).map((month) => {
      const entry = byMonth.get(month);
      return {
        month,
        label: formatMonthShort(month),
        receipts: entry?.receipts ?? money(0),
        outgoings: entry?.outgoings ?? money(0),
      };
    });
  },

  /** Note printed under the chart, e.g. the month with an unusual one-off. */
  cashFlowNote(asOf: IsoDate, months = CASH_FLOW_MONTHS): string | null {
    const notes = cashFlowService
      .recentMonths(asOf, months)
      .map((entry) => entry.note)
      .filter((note): note is string => Boolean(note));
    return notes.length > 0 ? notes.join(' · ') : null;
  },

  /** Latest posted month with its month-on-month movement, for the two cash KPIs. */
  monthlyCashSummary(asOf: IsoDate): {
    readonly monthLabel: string;
    readonly receipts: Money;
    readonly outgoings: Money;
    readonly loanPrincipal: Money;
    readonly receiptsChangeRatio: number | null;
    readonly outgoingsChangeRatio: number | null;
    readonly priorMonthLabel: string | null;
  } | null {
    const latest = cashFlowService.latestMonth(asOf);
    if (!latest) return null;
    const prior = cashFlowService.priorMonth(asOf);

    const ratio = (current: Money, previous: Money | undefined): number | null =>
      previous && previous.cents !== 0 ? (current.cents - previous.cents) / previous.cents : null;

    return {
      monthLabel: formatMonthShort(latest.month),
      receipts: latest.receipts,
      outgoings: latest.outgoings,
      loanPrincipal: latest.loanPrincipalComponent,
      receiptsChangeRatio: ratio(latest.receipts, prior?.receipts),
      outgoingsChangeRatio: ratio(latest.outgoings, prior?.outgoings),
      priorMonthLabel: prior ? formatMonthShort(prior.month) : null,
    };
  },

  /**
   * The three financial views, reported separately (BR-03).
   *
   * `cashFlow` counts loan principal as an outflow because the money genuinely
   * left the account. `operatingResult` excludes it and counts interest instead,
   * because repaying a debt is not a cost of operating. Reporting one number for
   * both is the mistake this rule exists to prevent.
   */
  financialPosition(asOf: IsoDate): FinancialPosition {
    // Report on the latest *posted* period, not the calendar month containing
    // `asOf`. A part-reconciled current month would mix settled and unsettled
    // figures, which is exactly the ambiguity BR-03 is trying to remove.
    const posted = cashFlowService.latestMonth(asOf);
    const periodFrom = posted ? startOfMonth(posted.month) : startOfMonth(asOf);
    const periodTo = posted ? endOfMonth(posted.month) : endOfMonth(asOf);

    const receipts = posted?.receipts ?? money(0);
    const outgoings = posted?.outgoings ?? money(0);
    const loanPrincipal = posted?.loanPrincipalComponent ?? money(0);

    // Transfers and drawdowns never entered the posted figures; report the
    // amount excluded so the omission is visible rather than silent.
    const excludedTransfers = sumMoney(
      reconciliationService
        .excludedTransferAmounts(periodFrom, periodTo)
        .map((amount) => money(Math.abs(amount.cents), amount.currency)),
    );

    // Rent charged in the period is the operating income measure; receipts are
    // the cash measure, and the two differ whenever a tenant is in arrears.
    const income = sumMoney(
      leasesRepository
        .listAllCharges()
        // A utility recovery passes a cost through to the tenant; it is not income.
        .filter((charge) => charge.kind !== 'utility' && charge.dueOn >= periodFrom && charge.dueOn <= periodTo)
        .map((charge) => charge.amount),
    );

    const operatingExpenses = expensesService.total({ from: periodFrom, to: periodTo });
    const interestExpense = loansService.monthlyRepayments().interest;

    return {
      periodFrom,
      periodTo,
      cashFlow: {
        receipts,
        outgoings,
        net: subtractMoney(receipts, outgoings),
        loanPrincipal,
        excludedTransfers,
      },
      operatingResult: {
        income,
        operatingExpenses,
        interestExpense,
        net: subtractMoney(income, addMoney(operatingExpenses, interestExpense)),
        depreciation: null,
      },
      taxEstimate: null,
      taxEstimateNote:
        'Tax outcomes are not estimated. Jurisdiction-specific rules require professional validation before activation.',
    };
  },

  /**
   * The "needs attention" strip.
   *
   * Only genuine, actionable gaps appear here — each item links to the screen
   * where it can be resolved, and disappears once it is.
   */
  attentionItems(asOf: IsoDate): readonly AttentionItem[] {
    const items: AttentionItem[] = [];

    const stale = propertiesService.staleValuationProperties(asOf);
    if (stale.length > 0) {
      items.push({
        id: 'stale-valuations',
        tone: 'warn',
        icon: 'i-clock',
        title: `${stale.length} stale valuation${stale.length === 1 ? '' : 's'}`,
        detail: 'Older than 12 months · totals shown with last known value',
        href: '/properties',
      });
    }

    const unmatched = reconciliationService.unmatchedCount();
    if (unmatched > 0) {
      const current = reconciliationService.currentImport();
      const value = reconciliationService.unmatchedValue();
      items.push({
        id: 'unmatched-transactions',
        tone: 'info',
        icon: 'i-wallet',
        title: `${unmatched} unmatched transaction${unmatched === 1 ? '' : 's'}`,
        detail: current
          ? `From ${current.accountLabel} import ${formatImportDate(current.importedOn)} · ${formatShortMoney(value)} awaiting allocation`
          : `${formatShortMoney(value)} awaiting allocation`,
        href: '/bank-import',
      });
    }

    const overdue = obligationsService.overdue(asOf);
    if (overdue.length > 0) {
      items.push({
        id: 'overdue-obligations',
        tone: 'bad',
        icon: 'i-alert',
        title: `${overdue.length} obligation${overdue.length === 1 ? '' : 's'} overdue`,
        detail: 'Reminders sent · still unpaid · owner task created',
        href: '/obligations',
      });
    }

    propertiesService.ownershipGaps(asOf).forEach((gap) => {
      items.push({
        id: `ownership-gap-${gap.propertyId}`,
        tone: 'warn',
        icon: 'i-link',
        title: '1 ownership gap',
        detail: `${gap.propertyName.split(',')[0]}: ${gap.reason}`,
        href: '/entities',
      });
    });

    return items;
  },

  /**
   * Everything the dashboard screen needs, in one call.
   *
   * `scope` narrows the balance-sheet figures — net worth, assets, liabilities,
   * stale valuations and the ownership view — to one entity. Cash flow, arrears,
   * obligations and the attention strip stay portfolio-wide: those records carry
   * no entity dimension, and apportioning them by guesswork would invent figures.
   */
  overview(asOf: IsoDate, scope: DashboardScope | null = null) {
    const arrears = leasesService.arrearsSummary(asOf);
    return {
      asOf,
      scope,
      netWorth: dashboardService.netWorth(asOf, scope?.entityId),
      ownership: dashboardService.ownershipPositions(asOf, scope?.entityId),
      cashFlow: dashboardService.cashFlow(asOf),
      cashFlowNote: dashboardService.cashFlowNote(asOf),
      monthlyCash: dashboardService.monthlyCashSummary(asOf),
      scenario: scenarioInputs(asOf),
      arrears,
      arrearsPositions: leasesService.listArrears(asOf),
      upcoming: obligationsService.upcoming(asOf, UPCOMING_WINDOW_DAYS),
      upcomingSummary: obligationsService.upcomingSummary(asOf, UPCOMING_WINDOW_DAYS),
      attention: dashboardService.attentionItems(asOf),
      openObligations: obligationsService.openCount(asOf),
    };
  },
};

function formatImportDate(date: IsoDate): string {
  return `${Number(date.slice(8, 10))} ${formatMonthShort(startOfMonth(date))}`;
}

function formatShortMoney(value: Money): string {
  return `$${Math.round(value.cents / 100).toLocaleString('en-AU')}`;
}
