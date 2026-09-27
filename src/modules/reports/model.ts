/**
 * Reports domain model (RPT01–RPT04).
 *
 * A report job is generated from one calculation run and stores the finished
 * file, so repeating the download returns exactly what was generated, and a
 * later model change never alters an issued report. Comments and attachment
 * names append to a completed snapshot without touching its figures.
 */
import type { CalculationRunId, IsoDateTime, ProjectId, ReportJobId, ScenarioId, UserId } from '@/shared/types/common';

export type ReportTemplate =
  | 'feasibility-summary'
  | 'monthly-cashflow'
  | 'cost-commitment-register'
  | 'invoice-status-register'
  | 'funding-schedule'
  | 'scenario-comparison'
  | 'investor-distribution';

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  'feasibility-summary',
  'monthly-cashflow',
  'cost-commitment-register',
  'invoice-status-register',
  'funding-schedule',
  'scenario-comparison',
  'investor-distribution',
];

export const REPORT_TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  'feasibility-summary': 'Feasibility summary',
  'monthly-cashflow': 'Detailed monthly cashflow',
  'cost-commitment-register': 'Cost and commitment register',
  'invoice-status-register': 'Invoice status register',
  'funding-schedule': 'Funding schedule',
  'scenario-comparison': 'Scenario comparison',
  'investor-distribution': 'Investor distribution report',
};

/** R1: CSV plus a printable view. PDF and XLSX are R2 (RPT02). */
export type ReportFormat = 'csv';

export type ReportJobState = 'queued' | 'running' | 'completed' | 'failed';

export interface ReportTable {
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ReportJob {
  readonly id: ReportJobId;
  readonly projectId: ProjectId;
  readonly template: ReportTemplate;
  readonly format: ReportFormat;
  readonly state: ReportJobState;
  readonly runId: CalculationRunId | null;
  readonly scenarioIds: readonly ScenarioId[];
  readonly basis: 'economic' | 'gross';
  readonly includeSensitive: boolean;
  /** Set for an investor's report: only this participant's figures are included (EQ03). */
  readonly participantId: string | null;
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
  readonly completedAt?: IsoDateTime;
  readonly error?: string;
  /** Snapshot facts printed on every page and in the CSV preamble (RPT02). */
  readonly meta?: {
    readonly projectCode: string;
    readonly projectName: string;
    readonly scenarioLabel: string;
    readonly modelRevision: number;
    readonly engineVersion: string;
    readonly actualsCutoff: string;
    readonly taxBasis: string;
    readonly generatedAt: IsoDateTime;
  };
  readonly tables?: readonly ReportTable[];
  readonly csv?: string;
  /** sha256 of the data rows, excluding the generation time — equal for an unchanged snapshot (RPT03). */
  readonly dataHash?: string;
  readonly comments: readonly { readonly id: string; readonly at: IsoDateTime; readonly by: UserId; readonly text: string; readonly attachmentName?: string }[];
  /** A failed retry points at the job it retried; the earlier successful report is never overwritten. */
  readonly retryOf?: ReportJobId;
}
