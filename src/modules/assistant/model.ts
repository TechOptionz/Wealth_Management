/**
 * Assistant domain model (AI01–AI08).
 *
 * The Assistant answers from authorised server tools over the same calculation
 * run every screen shows. No language-model provider is connected in this
 * build: a question is routed to tools by the words the *user* typed, and the
 * answer is assembled from the tools' structured facts. Text inside invoices,
 * comments or documents is data only — it can never pick a tool, change a
 * permission or trigger a write (AI06).
 */
import type { AssistantRequestId, IsoDateTime, ProjectId, UserId } from '@/shared/types/common';

export type AssistantTool =
  | 'getProjectSummary'
  | 'getCashflow'
  | 'getCostBreakdown'
  | 'findInvoices'
  | 'compareScenarios'
  | 'explainCalculation'
  | 'getMyParticipation';

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  'getProjectSummary',
  'getCashflow',
  'getCostBreakdown',
  'findInvoices',
  'compareScenarios',
  'explainCalculation',
  'getMyParticipation',
];

export interface Citation {
  readonly label: string;
  /** Path inside the project, e.g. "invoices?invoice=…". */
  readonly href: string;
}

export interface AnswerLine {
  readonly text: string;
  /** Facts are recorded; forecasts are modelled; notes are caveats (AI01). */
  readonly kind: 'fact' | 'forecast' | 'note';
}

export interface AssistantAnswer {
  readonly lines: readonly AnswerLine[];
  readonly citations: readonly Citation[];
  readonly toolsUsed: readonly AssistantTool[];
  readonly runId: string | null;
  readonly modelRevision: number | null;
  readonly stale: boolean;
  /** True when the question could not be answered from the available evidence (AI08). */
  readonly insufficientEvidence: boolean;
}

export interface AssistantRequest {
  readonly id: AssistantRequestId;
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly at: IsoDateTime;
  /** Redacted: long digit runs (bank details, references) are masked before storage (AI07, AI08). */
  readonly question: string;
  readonly toolsUsed: readonly AssistantTool[];
  readonly deniedTools: readonly AssistantTool[];
  readonly runId: string | null;
  readonly outcome: 'answered' | 'insufficient-evidence' | 'denied' | 'disabled';
  readonly latencyMs: number;
  readonly answer: AssistantAnswer;
}
