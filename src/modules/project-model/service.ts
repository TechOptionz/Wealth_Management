/**
 * Project model business logic (CAL05, CF01–CF05, SUM01–SUM03, PRG03, PRJ04).
 *
 * `calculate` is the single entry point: gather input, hash it, reuse a run
 * with the same hash, otherwise compute and store an immutable run — and only
 * if the project's revision is still the one the input was built from. Every
 * view (grid, summary, drill-through, scenarios, reports, Assistant) reads a
 * run; nothing renders a figure that was not produced by `computeModel`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { ENGINE_VERSION, formatPpmAsPercent, type MonthKey } from '@/shared/finance-engine';
import { ConflictError, NotFoundError } from '@/shared/lib/errors';
import { formatMoney, money } from '@/shared/lib/money';
import { formatDateShort } from '@/shared/lib/dates';
import { asId, type IsoDate, type MilestoneId, type ProjectId, type ScenarioId, type UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { TaxDisplayBasis } from '@/modules/projects/model';
import { budgetsService } from '@/modules/budgets/service';
import { commitmentsService } from '@/modules/commitments/service';
import { invoicesService } from '@/modules/invoices/service';
import { programmeService } from '@/modules/programme/service';
import { salesService } from '@/modules/sales/service';
import { fundingService } from '@/modules/funding/service';
import { computeModel } from './compute';
import { buildModelInput, type BuildInputOptions } from './inputs';
import { projectModelRepository } from './repository';
import type { BasisView, CalculationRun, CellContribution, GridRow, ModelInput, ModelResult, ModelWarning, ScenarioOverrides } from './model';

/** Optional summary columns the column chooser can add (CF01). */
export type SummaryColumnKey = 'current' | 'expended' | 'baseline' | 'variance' | 'committed' | 'approvedUnpaid' | 'remainingForecast';

export const DEFAULT_SUMMARY_COLUMNS: readonly SummaryColumnKey[] = ['current', 'expended'];
export const ALL_SUMMARY_COLUMNS: readonly SummaryColumnKey[] = ['current', 'expended', 'baseline', 'variance', 'committed', 'approvedUnpaid', 'remainingForecast'];

export const SUMMARY_COLUMN_LABELS: Record<SummaryColumnKey, { readonly label: string; readonly basis: string }> = {
  current: { label: 'Current', basis: 'Expected final amount for the line on the selected tax basis (EAC = approved + unbilled commitments + uncommitted forecast).' },
  expended: { label: 'Expended', basis: 'Actual paid cash allocated to the line, not merely approved invoices.' },
  baseline: { label: 'Baseline', basis: 'The selected published baseline, frozen when it was approved.' },
  variance: { label: 'Variance', basis: 'Current minus baseline. Positive is adverse for a cost — said in words beside the figure.' },
  committed: { label: 'Committed', basis: 'Authorised commitments including approved variations.' },
  approvedUnpaid: { label: 'Approved unpaid', basis: 'Authorised amounts awaiting settlement, on the gross (payable) basis, including retention.' },
  remainingForecast: { label: 'Remaining forecast', basis: 'Unbilled commitments plus the uncommitted allowance still to be spent.' },
};

export interface ExceptionItem {
  readonly rule: string;
  readonly severity: 'bad' | 'warn' | 'info';
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly count?: number;
}

export interface MilestoneMovePreview {
  readonly moves: readonly { readonly milestoneId: string; readonly name: string; readonly from: IsoDate; readonly to: IsoDate }[];
  readonly blocked: readonly { readonly milestoneId: string; readonly name: string; readonly reason: string }[];
  readonly costLinesMoved: readonly { readonly code: string; readonly title: string; readonly monthsChanged: number; readonly netChangeCents: number }[];
  readonly settlementReceiptsMoved: number;
  readonly before: { readonly peakDebtCents: number; readonly financeCostCents: number; readonly fundingGapCents: number; readonly completionDate: IsoDate; readonly profitCents: number };
  readonly after: { readonly peakDebtCents: number; readonly financeCostCents: number; readonly fundingGapCents: number; readonly completionDate: IsoDate; readonly profitCents: number };
}

function hashInput(input: ModelInput, overrides: ScenarioOverrides | null): string {
  return createHash('sha256').update(JSON.stringify({ input, overrides, engine: ENGINE_VERSION })).digest('hex');
}

function actorName(userId: UserId | undefined): string {
  return (userId && accessService.resolveUserName(userId)) || 'system';
}

export const projectModelService = {
  buildInput(projectId: ProjectId, options: BuildInputOptions = {}): ModelInput {
    return buildModelInput(projectId, options);
  },

  /**
   * Calculate (or reuse) the run for a project's current inputs (CAL05).
   *
   * Save inputs first, calculate second, publish only if the input revision is
   * still current: if another request changed the project while this ran, the
   * run is discarded with a conflict rather than stored against stale inputs.
   */
  calculate(
    projectId: ProjectId,
    options: { readonly overrides?: ScenarioOverrides | null; readonly scenarioId?: ScenarioId | null; readonly asOf?: IsoDate; readonly actor?: UserId; readonly input?: ModelInput } = {},
  ): CalculationRun {
    const input = options.input ?? buildModelInput(projectId, { asOf: options.asOf });
    const overrides = options.overrides ?? null;
    const scenarioId = options.scenarioId ?? null;
    const inputHash = hashInput(input, overrides);
    const existing = projectModelRepository.findByHash(projectId, inputHash, scenarioId);
    if (existing) return existing;

    const { result } = computeModel(input, overrides ? { overrides } : {});
    const current = projectsService.require(projectId).modelRevision;
    if (!options.input && current !== input.modelRevision) {
      throw new ConflictError('The project changed while it was being calculated. Try again.', { inputRevision: input.modelRevision, currentRevision: current });
    }
    const run: CalculationRun = {
      id: asId<'CalculationRun'>(`run-${randomUUID()}`),
      projectId,
      scenarioId,
      modelRevision: input.modelRevision,
      actualsCutoff: input.cutoff,
      inputHash,
      policyVersion: input.policyVersion,
      engineVersion: ENGINE_VERSION,
      status: result.warnings.some((warning) => warning.code === 'nonconvergent') ? 'nonconvergent' : 'completed',
      createdAt: new Date().toISOString(),
      createdBy: options.actor ?? accessService.getCurrentUser().id,
      input,
      overrides,
      result,
      warnings: result.warnings,
    };
    try {
      return projectModelRepository.insertRun(run);
    } catch (error) {
      // A page render loads data read-only (Postgres adapter): the run is still
      // the deterministic result of this input, so it is shown, and stored the
      // next time a write-capable request (action, route, report) calculates.
      if (error instanceof Error && /read-only/.test(error.message)) return run;
      throw error;
    }
  },

  /** Re-run a stored run's frozen input with different overrides (scenarios pin their base snapshot). */
  recalculateFrom(run: CalculationRun, overrides: ScenarioOverrides | null, scenarioId: ScenarioId | null, actor?: UserId): CalculationRun {
    return projectModelService.calculate(run.projectId, { input: run.input, overrides, scenarioId, actor });
  },

  /** Compute without storing — for analyses such as a sensitivity matrix, never for a published figure. */
  computeEphemeral(input: ModelInput, overrides: ScenarioOverrides | null): ModelResult {
    return computeModel(input, overrides ? { overrides } : {}).result;
  },

  latestRun(projectId: ProjectId, scenarioId: ScenarioId | null = null): CalculationRun | undefined {
    return projectModelRepository.latestRun(projectId, scenarioId);
  },

  requireRun(runId: string): CalculationRun {
    const run = projectModelRepository.findRun(asId<'CalculationRun'>(runId));
    if (!run) throw new NotFoundError('Calculation run', runId);
    return run;
  },

  /** A run is stale when the project moved on since it was calculated (SUM01, SCN04). */
  isStale(run: CalculationRun): boolean {
    const project = projectsService.require(run.projectId);
    return project.modelRevision !== run.modelRevision || run.engineVersion !== ENGINE_VERSION;
  },

  view(run: CalculationRun, basis: TaxDisplayBasis): BasisView {
    return basis === 'gross' ? run.result.gross : run.result.economic;
  },

  /** Contributions behind one cell (CF05), recomputed from the run's frozen input so they match exactly. */
  cellContributions(run: CalculationRun, rowId: string, month: MonthKey, basis: TaxDisplayBasis): readonly CellContribution[] {
    const { contributions } = computeModel(run.input, { ...(run.overrides ? { overrides: run.overrides } : {}), collect: { rowId, month, basis } });
    return contributions;
  },

  rowById(run: CalculationRun, basis: TaxDisplayBasis, rowId: string): GridRow | undefined {
    return projectModelService.view(run, basis).rows.find((row) => row.id === rowId);
  },

  /** Actionable exceptions, each naming its rule and where to resolve it (SUM03). */
  exceptions(projectId: ProjectId, run: CalculationRun, asOf: IsoDate): readonly ExceptionItem[] {
    const items: ExceptionItem[] = [];
    const base = `/projects/${encodeURIComponent(projectId)}`;
    const totals = run.result.gross.totals;

    const unfunded = totals.filter((t) => t.unfundedCents > 0);
    if (unfunded.length > 0) {
      const first = unfunded[0];
      items.push({ rule: 'CF08 · unfunded period', severity: 'bad', title: `${unfunded.length} month${unfunded.length === 1 ? '' : 's'} not fully funded`, detail: `First in ${first?.month}: ${formatMoney(money(first?.unfundedCents ?? 0))} uncovered by authorised equity or debt.`, href: `${base}/finance`, count: unfunded.length });
    }
    const breaches = run.result.warnings.filter((w) => w.code === 'facility-breach');
    if (breaches.length > 0) {
      items.push({ rule: 'FIN03 · facility breach', severity: 'bad', title: 'Debt limit or maturity breached', detail: breaches[0]?.message ?? '', href: `${base}/finance`, count: breaches.length });
    }
    const overdue = [...invoicesService.approvedUnpaidByLine(projectId).values()].flat().filter((u) => u.expectedPaymentDate < asOf);
    if (overdue.length > 0) {
      const total = overdue.reduce((sum, u) => sum + u.gross.cents - u.retention.cents, 0);
      items.push({ rule: 'SUM03 · overdue approved invoice', severity: 'warn', title: `${overdue.length} approved invoice${overdue.length === 1 ? '' : 's'} past expected payment`, detail: `${formatMoney(money(total))} approved and unpaid beyond the expected date.`, href: `${base}/invoices`, count: overdue.length });
    }
    const overBaseline = run.result.positions.filter((p) => (p.varianceCents ?? 0) > 0);
    if (overBaseline.length > 0) {
      const total = overBaseline.reduce((sum, p) => sum + (p.varianceCents ?? 0), 0);
      items.push({ rule: 'CST · cost above baseline', severity: 'warn', title: `${overBaseline.length} cost line${overBaseline.length === 1 ? '' : 's'} over baseline`, detail: `${formatMoney(money(total))} adverse against the selected baseline (${overBaseline.slice(0, 3).map((p) => p.code).join(', ')}${overBaseline.length > 3 ? '…' : ''}).`, href: `${base}/costs`, count: overBaseline.length });
    }
    const needsReview = invoicesService.listInvoices(projectId).filter((invoice) => invoice.reviewState === 'needs-review' || invoice.reviewState === 'received');
    if (needsReview.length > 0) {
      items.push({ rule: 'INV08 · unallocated document', severity: 'info', title: `${needsReview.length} invoice${needsReview.length === 1 ? '' : 's'} awaiting review`, detail: 'Coding or allocation still incomplete.', href: `${base}/invoices`, count: needsReview.length });
    }
    const duplicates = invoicesService.listInvoices(projectId).filter((invoice) => {
      if (invoice.reviewState === 'void' || invoice.reviewState === 'rejected') return false;
      const findings = invoicesService.duplicateFindings(invoice.id);
      return findings.exact.length + findings.checksum.length + findings.similar.length > 0 && !invoice.duplicateOverride;
    });
    if (duplicates.length > 0) {
      items.push({ rule: 'INV04 · duplicate warning', severity: 'warn', title: `${duplicates.length} possible duplicate${duplicates.length === 1 ? '' : 's'}`, detail: 'Exact or near-matching invoices need a resolution before approval.', href: `${base}/invoices`, count: duplicates.length });
    }
    items.push({ rule: 'INT · accounting connection', severity: 'info', title: 'No accounting connection', detail: 'Actual payments are imported and reviewed manually; nothing is synchronised.', href: `${base}/invoices` });
    if (projectModelService.isStale(run)) {
      items.push({ rule: 'CAL05 · stale calculation', severity: 'warn', title: 'Calculation is behind the model', detail: `Run is for revision ${run.modelRevision}; the project is at revision ${projectsService.require(projectId).modelRevision}. Reload to recalculate.`, href: `${base}/summary` });
    }
    if (run.input.unmatchedPayments.length > 0) {
      items.push({ rule: 'CAL06 · suspense items', severity: 'warn', title: `${run.input.unmatchedPayments.length} unmatched payment${run.input.unmatchedPayments.length === 1 ? '' : 's'} in suspense`, detail: 'The project cannot be described as fully reconciled until they are matched or excluded.', href: `${base}/invoices`, count: run.input.unmatchedPayments.length });
    }
    return items;
  },

  /** What moving a milestone would do to money, before it is saved (PRG03). */
  previewMilestoneMove(projectId: ProjectId, milestoneId: MilestoneId, newPlannedDate: IsoDate): MilestoneMovePreview {
    const dates = programmeService.previewMove(milestoneId, newPlannedDate);
    const overrides = new Map<string, IsoDate>(dates.moves.map((move) => [move.milestoneId, move.to]));
    const baseInput = buildModelInput(projectId);
    const movedInput = buildModelInput(projectId, { milestoneDates: overrides });
    const before = computeModel(baseInput).result;
    const after = computeModel(movedInput).result;

    const costLinesMoved = before.gross.rows
      .filter((row) => row.section === 'costs' && row.posting)
      .flatMap((row) => {
        const moved = after.gross.rows.find((candidate) => candidate.id === row.id);
        if (!moved) return [];
        const monthsChanged = before.months.filter((month) => (row.months[month] ?? 0) !== (moved.months[month] ?? 0)).length;
        if (monthsChanged === 0) return [];
        return [{ code: row.code ?? '', title: row.label, monthsChanged, netChangeCents: moved.summary.current - row.summary.current }];
      });
    const settlementReceiptsMoved = before.gross.rows
      .filter((row) => row.section === 'revenue' && row.posting)
      .reduce((count, row) => {
        const moved = after.gross.rows.find((candidate) => candidate.id === row.id);
        if (!moved) return count;
        return count + before.months.filter((month) => (row.months[month] ?? 0) !== (moved.months[month] ?? 0)).length;
      }, 0);
    const summarise = (result: ModelResult) => ({
      peakDebtCents: result.gross.kpis.peakDebtCents,
      financeCostCents: result.gross.kpis.financeCostCents,
      fundingGapCents: result.gross.kpis.fundingGapCents,
      completionDate: result.gross.kpis.completionDate,
      profitCents: result.gross.kpis.profitCents,
    });
    return {
      moves: dates.moves,
      blocked: dates.blocked,
      costLinesMoved,
      settlementReceiptsMoved,
      before: summarise(before),
      after: summarise(after),
    };
  },

  /** PRJ04 — clone a project with separate structure/assumption choices; never facts. */
  cloneProject(input: { readonly sourceProjectId: ProjectId; readonly code: string; readonly name: string; readonly structure: boolean; readonly assumptions: boolean; readonly actor: UserId }) {
    const source = projectsService.require(input.sourceProjectId);
    const policy = projectsService.policyFor(source.id);
    const created = projectsService.createProject({
      code: input.code,
      name: input.name,
      legalEntityId: source.legalEntityId,
      type: source.type,
      address: source.address,
      state: source.state,
      startDate: source.startDate,
      expectedCompletion: source.expectedCompletion,
      forecastHorizonMonths: source.forecastHorizonMonths,
      reportingBasis: source.reportingBasis,
      timezone: source.timezone,
      openingCash: input.assumptions ? source.openingCash : money(0),
      openingRestrictedCash: money(0),
      actor: input.actor,
      clonedFromProjectId: source.id,
      ...(input.assumptions ? { policyTemplate: policy } : {}),
    });
    const options = { structure: input.structure, assumptions: input.assumptions };
    if (input.structure || input.assumptions) {
      // Programme first, so cost lines can re-point their milestone links by code.
      const clonedMilestones = programmeService.cloneInto(source.id, created.id, options, input.actor);
      const sourceByCode = new Map(programmeService.listMilestones(source.id).map((m) => [m.code, m.id]));
      const milestoneMap = new Map<MilestoneId, MilestoneId>();
      for (const cloned of clonedMilestones) {
        const original = sourceByCode.get(cloned.code);
        if (original) milestoneMap.set(original, cloned.id);
      }
      budgetsService.cloneInto(source.id, created.id, { ...options, milestoneMap }, input.actor);
      salesService.cloneInto(source.id, created.id, options, input.actor);
      fundingService.cloneInto(source.id, created.id, options, input.actor);
      // Suppliers are structure; contracts, invoices and payments are facts and are never cloned.
      if (input.structure) commitmentsService.cloneInto(source.id, created.id, {}, input.actor);
    }
    accessService.record({
      actor: actorName(input.actor),
      summary: `Project cloned · ${source.code} → ${created.code}`,
      context: `structure ${input.structure ? 'yes' : 'no'} · assumptions ${input.assumptions ? 'yes' : 'no'} · no payments, approvals, credentials or audit copied`,
    });
    return created;
  },

  /** Words for a warning list, for the summary and the context bar. */
  describeWarnings(warnings: readonly ModelWarning[]): readonly string[] {
    return warnings.map((warning) => warning.message);
  },

  /** "rev 12 · 27 Sep · engine 1.0.0" */
  freshnessLabel(run: CalculationRun): string {
    return `run rev ${run.modelRevision} · ${formatDateShort(run.createdAt.slice(0, 10))} · engine ${run.engineVersion}${projectModelService.isStale(run) ? ' · STALE' : ''}`;
  },

  formatRate(ppm: number): string {
    return formatPpmAsPercent(ppm);
  },
};
