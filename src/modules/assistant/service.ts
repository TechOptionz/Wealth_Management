/**
 * Assistant business logic (AI01–AI08).
 *
 * Flow: the caller's permissions are resolved first (AI03) → the question is
 * routed to tools by keywords in the question only → each tool re-checks its
 * own permission before reading → the answer is assembled from structured
 * facts with record links and the run it came from → the request is logged
 * with sensitive digits masked (AI08). Nothing here writes to a financial
 * record; the only write is the request log.
 */
import { randomUUID } from 'node:crypto';
import { XIRR_UNAVAILABLE_LABELS } from '@/shared/finance-engine';
import { formatMoney, money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import { asId, type IsoDate, type ProjectId, type UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { ProjectPermission, ProjectScope } from '@/modules/projects/model';
import { projectModelService } from '@/modules/project-model/service';
import type { CalculationRun } from '@/modules/project-model/model';
import { invoicesService } from '@/modules/invoices/service';
import { commitmentsService } from '@/modules/commitments/service';
import { scenariosService } from '@/modules/scenarios/service';
import { COMPARISON_LABELS, METRIC_KIND } from '@/modules/scenarios/model';
import { fundingService } from '@/modules/funding/service';
import { assistantRepository } from './repository';
import type { AnswerLine, AssistantAnswer, AssistantRequest, AssistantTool, Citation } from './model';

/** Organisation switch for external AI processing (AI07). No provider is connected, so it only gates the feature. */
export function assistantEnabled(): boolean {
  return process.env.ASSISTANT_DISABLED?.trim().toLowerCase() !== 'true';
}

const TOOL_PERMISSION: Record<AssistantTool, ProjectPermission> = {
  getProjectSummary: 'financials.read',
  getCashflow: 'financials.read',
  getCostBreakdown: 'financials.read',
  findInvoices: 'financials.read',
  compareScenarios: 'financials.read',
  explainCalculation: 'financials.read',
  getMyParticipation: 'participation.read',
};

const $ = (cents: number): string => formatMoney(money(cents));

/** Mask anything that looks like an account number, BSB or long reference before it is logged (AI07). */
export function redact(text: string): string {
  return text.replace(/\d[\d\s-]{5,}\d/g, (match) => `${'•'.repeat(Math.max(match.replace(/\D/g, '').length - 2, 3))}${match.replace(/\D/g, '').slice(-2)}`).slice(0, 500);
}

/**
 * Route by the user's own words. Deliberately keyword-based and closed: an
 * instruction found in a document never reaches this function, and nothing
 * here maps to a write.
 */
export function routeQuestion(question: string): readonly AssistantTool[] {
  const q = question.toLowerCase();
  const tools = new Set<AssistantTool>();
  if (/(overrun|over budget|over baseline|variance|cost breakdown|which (cost|line)s?|categor)/.test(q)) tools.add('getCostBreakdown');
  if (/(cash|funding|need|shortfall|gap|next (month|quarter)|upcoming|requirement|when .* (cash|money))/.test(q)) tools.add('getCashflow');
  if (/(invoice|bill|unpaid|approved|awaiting|supplier|claim|duplicate|credit note)/.test(q)) tools.add('findInvoices');
  if (/(scenario|compare|delay|what if|sensitivit)/.test(q)) tools.add('compareScenarios');
  if (/(how is .* calculated|why|explain|formula|where does .* come from|basis)/.test(q)) tools.add('explainCalculation');
  if (/(my (capital|investment|return|distribution|participation)|how much have i)/.test(q)) tools.add('getMyParticipation');
  if (/(profit|margin|irr|return|summary|overview|feasib|peak debt|peak equity)/.test(q) || tools.size === 0) tools.add('getProjectSummary');
  return [...tools];
}

interface ToolContext {
  readonly projectId: ProjectId;
  readonly scope: ProjectScope;
  readonly run: CalculationRun | null;
  readonly question: string;
  readonly asOf: IsoDate;
}

interface ToolOutput {
  readonly lines: readonly AnswerLine[];
  readonly citations: readonly Citation[];
}

const TOOLS: Record<AssistantTool, (context: ToolContext) => ToolOutput> = {
  getProjectSummary: ({ run }) => {
    if (!run) return { lines: [], citations: [] };
    const k = run.result.economic.kpis;
    return {
      lines: [
        { kind: 'forecast', text: `Development profit is ${$(k.profitCents)} before income tax: net revenue ${$(k.netRevenueCents)}, economic cost ${$(k.economicCostCents)}, finance costs ${$(k.financeCostCents)}.` },
        { kind: 'forecast', text: `Margin on cost ${k.marginOnCost.available ? `${(k.marginOnCost.value * 100).toFixed(1)}%` : k.marginOnCost.reason}; margin on revenue ${k.marginOnRevenue.available ? `${(k.marginOnRevenue.value * 100).toFixed(1)}%` : k.marginOnRevenue.reason}.` },
        { kind: 'forecast', text: `Project IRR ${k.projectIrr.available ? `${(k.projectIrr.rate * 100).toFixed(2)}%` : XIRR_UNAVAILABLE_LABELS[k.projectIrr.reason]}; equity IRR ${k.equityIrr.available ? `${(k.equityIrr.rate * 100).toFixed(2)}%` : XIRR_UNAVAILABLE_LABELS[k.equityIrr.reason]}.` },
        { kind: 'forecast', text: `Peak debt ${$(k.peakDebtCents)}${k.peakDebtOn ? ` on ${formatDateLong(k.peakDebtOn)}` : ''}; peak equity ${$(k.peakEquityCents)}; completion ${formatDateLong(k.completionDate)}.` },
      ],
      citations: [{ label: 'Summary', href: 'summary' }],
    };
  },

  getCashflow: ({ run }) => {
    if (!run) return { lines: [], citations: [] };
    const forecast = run.result.gross.totals.filter((t) => !t.actual).slice(0, 3);
    const unfunded = run.result.gross.totals.filter((t) => t.unfundedCents > 0);
    return {
      lines: [
        ...forecast.map((t): AnswerLine => ({
          kind: 'forecast',
          text: `${t.month}: payments ${$(t.developmentPaymentsCents)}, receipts ${$(t.receiptsCents + t.depositsReleasedCents)}, equity ${$(t.equityContributionsCents)}, debt draws ${$(t.debtDrawsCents)}, closing cash ${$(t.closingCashCents)}.`,
        })),
        unfunded.length > 0
          ? { kind: 'forecast', text: `${unfunded.length} month(s) are not fully funded; the first is ${unfunded[0]?.month} with ${$(unfunded[0]?.unfundedCents ?? 0)} uncovered.` }
          : { kind: 'forecast', text: 'Every forecast month is covered by authorised equity and debt.' },
      ],
      citations: [{ label: 'Cashflow grid', href: 'cashflow?basis=gross' }, { label: 'Finance', href: 'finance' }],
    };
  },

  getCostBreakdown: ({ run }) => {
    if (!run) return { lines: [], citations: [] };
    const over = [...run.result.positions].filter((p) => (p.varianceCents ?? 0) !== 0).sort((a, b) => (b.varianceCents ?? 0) - (a.varianceCents ?? 0));
    const lines: AnswerLine[] = over.slice(0, 5).map((p) => ({
      kind: 'forecast',
      text: `${p.code}: expected final cost ${$(p.eacCents)} against baseline ${p.baselineCents === null ? 'none' : $(p.baselineCents)} — ${(p.varianceCents ?? 0) > 0 ? `${$(p.varianceCents ?? 0)} over (adverse)` : `${$(-(p.varianceCents ?? 0))} under (favourable)`}. Approved ${$(p.approvedCents)}, unbilled commitments ${$(p.unbilledCommitmentCents)}, uncommitted ${$(p.uncommittedCents)}.`,
    }));
    if (lines.length === 0) lines.push({ kind: 'forecast', text: 'Every cost line is on its baseline, or no baseline is published.' });
    return {
      lines,
      citations: over.slice(0, 5).map((p) => ({ label: p.code, href: `costs/${p.categoryId}?line=${p.lineId}` })),
    };
  },

  findInvoices: ({ projectId, question }) => {
    const q = question.toLowerCase();
    const invoices = invoicesService.listInvoices(projectId);
    const wanted = invoices.filter((invoice) => {
      if (/(awaiting|pending approval)/.test(q)) return invoice.reviewState === 'awaiting-approval';
      if (/(unpaid|owing|outstanding)/.test(q)) return invoice.reviewState === 'approved' && invoicesService.settlementSummary(invoice.id).unpaidBalance.cents > 0;
      if (/(hold)/.test(q)) return invoice.reviewState === 'on-hold';
      if (/duplicate/.test(q)) {
        const findings = invoicesService.duplicateFindings(invoice.id);
        return findings.exact.length + findings.checksum.length + findings.similar.length > 0;
      }
      const numbers = q.match(/[a-z]*-?\d{3,}/g) ?? [];
      if (numbers.length > 0) return numbers.some((n) => invoice.normalisedNumber.includes(n.replace(/[^a-z0-9]/g, '')));
      return invoice.reviewState !== 'void' && invoice.reviewState !== 'rejected';
    });
    return {
      lines: wanted.slice(0, 8).map((invoice): AnswerLine => {
        const revision = invoicesService.currentRevision(invoice);
        const settlement = invoicesService.settlementSummary(invoice.id);
        return {
          kind: 'fact',
          text: `${invoice.number} · ${commitmentsService.requireSupplier(invoice.supplierId).name} · gross ${$(revision.gross.cents)} · ${invoice.reviewState.replace(/-/g, ' ')} · ${settlement.state.replace(/-/g, ' ')}${settlement.unpaidBalance.cents > 0 ? ` (${$(settlement.unpaidBalance.cents)} unpaid)` : ''}.`,
        };
      }),
      citations: wanted.slice(0, 8).map((invoice) => ({ label: invoice.number, href: `invoices?invoice=${invoice.id}` })),
    };
  },

  compareScenarios: ({ projectId }) => {
    const scenarios = scenariosService.list(projectId).filter((s) => s.state !== 'archived').slice(0, 3);
    if (scenarios.length === 0) return { lines: [{ kind: 'note', text: 'There are no scenarios to compare.' }], citations: [] };
    const columns = scenariosService.compare(projectId, scenarios.map((s) => s.id));
    const lines: AnswerLine[] = [];
    for (const column of columns.slice(1)) {
      const profit = column.variances?.profit ?? null;
      const completion = column.variances?.completion ?? null;
      lines.push({
        kind: 'forecast',
        text: `${column.label}: profit ${profit === null ? 'not comparable' : `${profit >= 0 ? '+' : '−'}${$(Math.abs(profit))}`}, ${COMPARISON_LABELS.completion.toLowerCase()} ${completion === null ? 'n/a' : `${completion >= 0 ? '+' : ''}${completion} days`}, peak debt ${column.values.peakDebt.value === null ? 'n/a' : $(column.values.peakDebt.value as number)}${column.stale ? ' (stale — based on an earlier model revision)' : ''}.`,
      });
    }
    void METRIC_KIND;
    return { lines, citations: [{ label: 'Scenarios', href: `scenarios?compare=${scenarios.map((s) => s.id).join(',')}` }] };
  },

  explainCalculation: ({ run }) => ({
    lines: [
      { kind: 'note', text: 'Expected final cost = approved invoices + unbilled commitments (per contract, never negative) + the uncommitted forecast allowance. Approving an invoice against a contract moves cost between those parts; it never raises the total unless scope changed.' },
      { kind: 'note', text: 'Economic cost is gross cost less recoverable GST; profit = net revenue − economic development cost − finance costs, before income tax. Margins return “Not available” rather than 0% when the denominator is zero.' },
      { kind: 'note', text: `Months up to the actuals cutoff${run ? ` (${formatDateLong(run.actualsCutoff)})` : ''} hold recorded payments only; forecasts after it are spread by each line’s schedule. Funding covers shortfalls from committed equity first, then ranked debt; anything left is shown as unfunded.` },
    ],
    citations: [{ label: 'Cashflow drill-through', href: 'cashflow' }],
  }),

  getMyParticipation: ({ scope, asOf }) => {
    if (!scope.participantId) return { lines: [{ kind: 'note', text: 'This membership is not linked to an investor participation.' }], citations: [] };
    const participant = fundingService.requireParticipant(scope.participantId);
    const account = fundingService.capitalAccount(participant.id, asOf);
    const irr = fundingService.participantIrr(participant.id, asOf);
    return {
      lines: [
        { kind: 'fact', text: `${participant.name}: contributed ${$(account.contributed.cents)}, capital returned ${$(account.capitalReturned.cents)}, outstanding ${$(account.outstanding.cents)}.` },
        { kind: 'fact', text: `Preferred return accrued ${$(account.preferredAccrued.cents)}, paid ${$(account.preferredPaid.cents)}; profit distributed ${$(account.profitDistributed.cents)}.` },
        { kind: 'fact', text: `IRR to date ${irr.available ? `${(irr.rate * 100).toFixed(2)}%` : XIRR_UNAVAILABLE_LABELS[irr.reason]}.` },
      ],
      citations: [{ label: 'My participation', href: 'finance' }],
    };
  },
};

export const assistantService = {
  history(projectId: ProjectId, userId: UserId): readonly AssistantRequest[] {
    return assistantRepository.listFor(projectId, userId);
  },

  /**
   * Answer a question. `scope` must come from the project guard for the
   * requesting user — never from the question or a document (AI03).
   */
  ask(input: { readonly projectId: ProjectId; readonly scope: ProjectScope; readonly question: string; readonly asOf: IsoDate }): AssistantRequest {
    const started = Date.now();
    const question = input.question.trim().slice(0, 1_000);
    const base = { id: asId<'AssistantRequest'>(`ask-${randomUUID()}`), projectId: input.projectId, userId: input.scope.userId, at: new Date().toISOString(), question: redact(question) };

    if (!assistantEnabled()) {
      const answer: AssistantAnswer = { lines: [{ kind: 'note', text: 'The Assistant is turned off for this organisation. Every screen still works without it.' }], citations: [], toolsUsed: [], runId: null, modelRevision: null, stale: false, insufficientEvidence: true };
      return assistantRepository.insert({ ...base, toolsUsed: [], deniedTools: [], runId: null, outcome: 'disabled', latencyMs: Date.now() - started, answer });
    }

    const requested = routeQuestion(question);
    // AI03: check before retrieval. Investors are routed to their own participation only.
    const allowed = requested.filter((tool) => input.scope.permissions.includes(TOOL_PERMISSION[tool]));
    const denied = requested.filter((tool) => !allowed.includes(tool));
    const tools: AssistantTool[] = allowed.length > 0 ? allowed : input.scope.permissions.includes('participation.read') ? ['getMyParticipation'] : [];

    const needsRun = tools.some((tool) => tool !== 'findInvoices' && tool !== 'getMyParticipation');
    const run = needsRun ? projectModelService.calculate(input.projectId, { asOf: input.asOf, actor: input.scope.userId }) : null;
    const context: ToolContext = { projectId: input.projectId, scope: input.scope, run, question, asOf: input.asOf };

    const lines: AnswerLine[] = [];
    const citations: Citation[] = [];
    for (const tool of tools) {
      // AI03: and again before returning each tool's result.
      projectsService.requirePermission(input.scope, TOOL_PERMISSION[tool]);
      const output = TOOLS[tool](context);
      lines.push(...output.lines);
      citations.push(...output.citations);
    }
    const stale = run ? projectModelService.isStale(run) : false;
    if (run) lines.push({ kind: 'note', text: `From calculation run rev ${run.modelRevision} (engine ${run.engineVersion}), actuals to ${formatDateLong(run.actualsCutoff)}.${stale ? ' This run is behind the model — figures may be stale.' : ''}` });
    if (denied.length > 0) lines.push({ kind: 'note', text: 'Part of the question needs access this membership does not have, so it was not answered.' });
    const insufficient = lines.filter((line) => line.kind !== 'note').length === 0;
    if (insufficient) lines.push({ kind: 'note', text: 'There is not enough evidence in this project to answer that. No figure has been estimated.' });

    const answer: AssistantAnswer = { lines, citations, toolsUsed: tools, runId: run?.id ?? null, modelRevision: run?.modelRevision ?? null, stale, insufficientEvidence: insufficient };
    const request = assistantRepository.insert({
      ...base,
      toolsUsed: tools,
      deniedTools: denied,
      runId: run?.id ?? null,
      outcome: tools.length === 0 ? 'denied' : insufficient ? 'insufficient-evidence' : 'answered',
      latencyMs: Date.now() - started,
      answer,
    });
    accessService.record({
      actor: accessService.resolveUserName(input.scope.userId) ?? 'system',
      summary: `Assistant question · ${projectsService.require(input.projectId).code}`,
      context: `tools ${tools.join(', ') || 'none'}${denied.length ? ` · denied ${denied.join(', ')}` : ''} · ${request.outcome}`,
    });
    return request;
  },
};
