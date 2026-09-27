/**
 * Transport-agnostic handlers for the project model: Cashflow grid, Summary,
 * drill-through and the programme move preview. Every handler passes the two
 * doors (platform capability, project permission) before reading a run.
 */
import type { MonthKey } from '@/shared/finance-engine';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { asId, type IsoDate } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { TaxDisplayBasis } from '@/modules/projects/model';
import { projectModelService, type ExceptionItem, type MilestoneMovePreview, type SummaryColumnKey } from './service';
import type { BasisView, CalculationRun, CellContribution } from './model';

export interface CashflowPayload {
  readonly run: CalculationRun;
  readonly basis: TaxDisplayBasis;
  readonly view: BasisView;
  readonly columns: readonly SummaryColumnKey[];
  readonly stale: boolean;
}

export interface SummaryPayload {
  readonly run: CalculationRun;
  readonly basis: TaxDisplayBasis;
  readonly view: BasisView;
  readonly exceptions: readonly ExceptionItem[];
  readonly stale: boolean;
}

function resolveBasis(projectId: string, requested: string | undefined): TaxDisplayBasis {
  if (requested === 'gross' || requested === 'economic') return requested;
  return projectsService.policyFor(asId<'Project'>(projectId)).tax.displayBasis;
}

export const projectModelApi = {
  cashflow(rawProjectId: string, query: { readonly basis?: string; readonly columns?: readonly SummaryColumnKey[]; readonly asOf?: IsoDate }): CashflowPayload {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    const run = projectModelService.calculate(projectId, { asOf: query.asOf ?? resolveAsOfDate() });
    const basis = resolveBasis(rawProjectId, query.basis);
    return { run, basis, view: projectModelService.view(run, basis), columns: query.columns ?? ['current', 'expended'], stale: projectModelService.isStale(run) };
  },

  summary(rawProjectId: string, query: { readonly basis?: string; readonly asOf?: IsoDate }): SummaryPayload {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    const asOf = query.asOf ?? resolveAsOfDate();
    const run = projectModelService.calculate(projectId, { asOf });
    const basis = resolveBasis(rawProjectId, query.basis);
    return { run, basis, view: projectModelService.view(run, basis), exceptions: projectModelService.exceptions(projectId, run, asOf), stale: projectModelService.isStale(run) };
  },

  cell(rawProjectId: string, query: { readonly rowId: string; readonly month: MonthKey; readonly basis?: string; readonly asOf?: IsoDate }): { readonly run: CalculationRun; readonly basis: TaxDisplayBasis; readonly contributions: readonly CellContribution[] } {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    const run = projectModelService.calculate(projectId, { asOf: query.asOf ?? resolveAsOfDate() });
    const basis = resolveBasis(rawProjectId, query.basis);
    return { run, basis, contributions: projectModelService.cellContributions(run, query.rowId, query.month, basis) };
  },

  previewMilestoneMove(rawProjectId: string, milestoneId: string, newPlannedDate: IsoDate): MilestoneMovePreview {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    return projectModelService.previewMilestoneMove(projectId, asId<'Milestone'>(milestoneId), newPlannedDate);
  },

  /** The latest stored run, for callers that must not trigger a calculation (context bar). */
  latest(rawProjectId: string): CalculationRun | undefined {
    return projectModelService.latestRun(asId<'Project'>(rawProjectId));
  },
};
