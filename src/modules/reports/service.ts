/**
 * Reports business logic (RPT01–RPT04).
 *
 * Every report is built from one calculation run (CAL05) — the same run the
 * grid and summary show — plus the registers that own the listed records.
 * Numbers are written as plain decimals with a currency column so a
 * spreadsheet reads them as numbers; user-entered text that could be taken
 * for a formula is neutralised (RPT02, SEC02). Supplier and buyer details are
 * left out unless an authorised person asks for them.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { XIRR_UNAVAILABLE_LABELS, type XirrResult } from '@/shared/finance-engine';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import type { Available } from '@/shared/lib/result';
import { asId, type IsoDate, type ProjectId, type ReportJobId, type ScenarioId, type UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import type { ProjectScope } from '@/modules/projects/model';
import { projectModelService } from '@/modules/project-model/service';
import type { CalculationRun } from '@/modules/project-model/model';
import { budgetsService } from '@/modules/budgets/service';
import { commitmentsService } from '@/modules/commitments/service';
import { invoicesService } from '@/modules/invoices/service';
import { fundingService } from '@/modules/funding/service';
import { scenariosService } from '@/modules/scenarios/service';
import { COMPARISON_LABELS, COMPARISON_METRICS, METRIC_KIND } from '@/modules/scenarios/model';
import { reportsRepository } from './repository';
import { REPORT_TEMPLATE_LABELS, type ReportJob, type ReportTable, type ReportTemplate } from './model';

/** How long a signed download link stays valid (RPT03, SEC01). */
export const DOWNLOAD_LINK_SECONDS = 15 * 60;

interface GlobalWithSecret {
  __holdfastReportSecret__?: Buffer;
}

function signingSecret(): Buffer {
  const configured = process.env.REPORT_LINK_SECRET?.trim();
  if (configured) return Buffer.from(configured);
  const holder = globalThis as unknown as GlobalWithSecret;
  holder.__holdfastReportSecret__ ??= randomBytes(32);
  return holder.__holdfastReportSecret__;
}

function sign(jobId: string, userId: string, expires: number): string {
  return createHmac('sha256', signingSecret()).update(`${jobId}:${userId}:${expires}`).digest('hex');
}

/** Plain decimal from cents: 186000 → "1860.00". */
export function decimal(cents: number): string {
  const magnitude = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}

/** Text cells that a spreadsheet could run as a formula get a leading apostrophe (SEC02). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function ratio(value: Available<number>): string {
  return value.available ? (value.value * 100).toFixed(4) : '';
}

function irr(value: XirrResult): string {
  return value.available ? (value.rate * 100).toFixed(4) : '';
}

function irrNote(value: XirrResult): string {
  return value.available ? (value.warnings.join('; ') || '') : XIRR_UNAVAILABLE_LABELS[value.reason];
}

function toCsv(job: Pick<ReportJob, 'template'>, meta: NonNullable<ReportJob['meta']>, tables: readonly ReportTable[]): string {
  const lines: string[] = [
    `# ${REPORT_TEMPLATE_LABELS[job.template]}`,
    `# Project: ${meta.projectCode} ${meta.projectName}`,
    `# Scenario: ${meta.scenarioLabel}`,
    `# Model revision: ${meta.modelRevision}`,
    `# Engine version: ${meta.engineVersion}`,
    `# Actuals cutoff: ${meta.actualsCutoff}`,
    `# Tax basis: ${meta.taxBasis}`,
    `# Generated: ${meta.generatedAt}`,
    '# Amounts are decimal AUD; percentages are plain numbers (25.0000 = 25%).',
  ];
  for (const table of tables) {
    lines.push('', `# ${table.title}`, table.header.map(csvCell).join(','));
    for (const row of table.rows) lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function dataHash(tables: readonly ReportTable[]): string {
  return createHash('sha256').update(JSON.stringify(tables)).digest('hex');
}

function buildTables(input: {
  readonly template: ReportTemplate;
  readonly projectId: ProjectId;
  readonly run: CalculationRun;
  readonly basis: 'economic' | 'gross';
  readonly includeSensitive: boolean;
  readonly participantId: string | null;
  readonly scenarioIds: readonly ScenarioId[];
  readonly asOf: IsoDate;
}): ReportTable[] {
  const { run, basis, projectId } = input;
  const view = projectModelService.view(run, basis);
  const k = view.kpis;
  switch (input.template) {
    case 'feasibility-summary':
      return [
        {
          title: 'Key figures',
          header: ['Measure', 'Value', 'Currency', 'Note'],
          rows: [
            ['Gross revenue', decimal(k.grossRevenueCents), 'AUD', 'Consideration including GST'],
            ['Output GST', decimal(k.outputGstCents), 'AUD', ''],
            ['Net revenue', decimal(k.netRevenueCents), 'AUD', ''],
            ['Economic development cost', decimal(k.economicCostCents), 'AUD', 'Gross cost less recoverable GST'],
            ['Finance costs', decimal(k.financeCostCents), 'AUD', 'Interest, fees and finance cost lines'],
            ['Development profit', decimal(k.profitCents), 'AUD', 'Before income tax'],
            ['Margin on cost (%)', ratio(k.marginOnCost), '', k.marginOnCost.available ? '' : k.marginOnCost.reason],
            ['Margin on revenue (%)', ratio(k.marginOnRevenue), '', k.marginOnRevenue.available ? '' : k.marginOnRevenue.reason],
            ['Project IRR (%)', irr(k.projectIrr), '', irrNote(k.projectIrr)],
            ['Equity IRR (%)', irr(k.equityIrr), '', irrNote(k.equityIrr)],
            ['Peak debt', decimal(k.peakDebtCents), 'AUD', k.peakDebtOn ?? ''],
            ['Peak equity', decimal(k.peakEquityCents), 'AUD', k.peakEquityOn ?? ''],
            ['Funding gap', decimal(k.fundingGapCents), 'AUD', k.fundingGapCents > 0 ? 'Uncovered by authorised equity and debt' : 'Fully funded'],
            ['Baseline cost', k.baselineCostCents === null ? '' : decimal(k.baselineCostCents), 'AUD', k.baselineCostCents === null ? 'No baseline published' : ''],
            ['Cost variance to baseline', k.costVarianceCents === null ? '' : decimal(k.costVarianceCents), 'AUD', 'Positive is adverse'],
            ['Completion', k.completionDate, '', ''],
          ],
        },
        {
          title: 'Warnings',
          header: ['Warning'],
          rows: run.warnings.map((warning) => [safeText(warning.message)]),
        },
      ];
    case 'monthly-cashflow':
      return [
        {
          title: `Monthly cashflow (${basis})`,
          header: ['Row', 'Code', 'Kind', 'Current', 'Expended', ...run.result.months.map((m) => `${m}${m <= run.result.cutoffMonth ? ' actual' : ' forecast'}`), 'Currency'],
          rows: view.rows.map((row) => [
            safeText(row.label),
            safeText(row.code ?? ''),
            row.kind,
            decimal(row.summary.current),
            decimal(row.summary.expended),
            ...run.result.months.map((month) => decimal(row.months[month] ?? 0)),
            'AUD',
          ]),
        },
      ];
    case 'cost-commitment-register': {
      const positions = new Map(run.result.positions.map((p) => [p.lineId, p]));
      const lines = budgetsService.postingLines(projectId);
      const commitments = commitmentsService.listCommitments(projectId);
      return [
        {
          title: 'Cost lines (economic basis; approved unpaid and remaining cash gross)',
          header: ['Code', 'Title', 'Baseline', 'Committed', 'Approved', 'Approved unpaid', 'Unbilled commitments', 'Uncommitted forecast', 'EAC', 'Variance', 'Remaining cash', 'Currency'],
          rows: lines.map((line) => {
            const p = positions.get(line.id);
            return [
              safeText(line.code),
              safeText(line.title),
              p?.baselineCents === null || p?.baselineCents === undefined ? '' : decimal(p.baselineCents),
              decimal(p?.committedCents ?? 0),
              decimal(p?.approvedCents ?? 0),
              decimal(p?.approvedUnpaidCents ?? 0),
              decimal(p?.unbilledCommitmentCents ?? 0),
              decimal(p?.uncommittedCents ?? 0),
              decimal(p?.eacCents ?? 0),
              p?.varianceCents === null || p?.varianceCents === undefined ? '' : decimal(p.varianceCents),
              decimal(p?.remainingCashCents ?? 0),
              'AUD',
            ];
          }),
        },
        {
          title: 'Commitments (gross)',
          header: ['Reference', 'Supplier', 'Contract total', 'Invoiced to date', 'Paid to date', 'Approved unpaid', 'Uninvoiced balance', 'Pending variations (net)', 'Currency'],
          rows: commitments.map((commitment) => {
            const position = invoicesService.contractPosition(commitment.id);
            return [
              safeText(commitment.reference),
              input.includeSensitive ? safeText(commitmentsService.requireSupplier(commitment.supplierId).name) : 'Withheld',
              decimal(position.contractTotal.cents),
              decimal(position.invoicedToDate.cents),
              decimal(position.paidToDate.cents),
              decimal(position.approvedUnpaid.cents),
              decimal(position.uninvoicedBalance.cents),
              decimal(commitmentsService.pendingVariationsTotal(commitment.id).cents),
              'AUD',
            ];
          }),
        },
      ];
    }
    case 'invoice-status-register':
      return [
        {
          title: 'Invoices',
          header: ['Number', 'Type', 'Supplier', 'Invoice date', 'Due date', 'Net', 'GST', 'Gross', 'Review state', 'Sync state', 'Settlement', 'Unpaid balance', 'Currency'],
          rows: invoicesService.listInvoices(projectId).map((invoice) => {
            const revision = invoicesService.currentRevision(invoice);
            const settlement = invoicesService.settlementSummary(invoice.id);
            return [
              safeText(invoice.number),
              invoice.type,
              input.includeSensitive ? safeText(commitmentsService.requireSupplier(invoice.supplierId).name) : 'Withheld',
              revision.invoiceDate,
              revision.dueDate,
              decimal(revision.net.cents),
              decimal(revision.tax.cents),
              decimal(revision.gross.cents),
              invoice.reviewState,
              invoice.syncState,
              settlement.state,
              decimal(settlement.unpaidBalance.cents),
              'AUD',
            ];
          }),
        },
      ];
    case 'funding-schedule':
      return [
        {
          title: 'Monthly funding',
          header: ['Month', 'Basis', 'Equity contributions', 'Debt draws', 'Principal repayments', 'Cash interest', 'Capitalised interest', 'Fees', 'Distributions', 'Unfunded', 'Closing cash', 'Debt outstanding', 'Currency'],
          rows: run.result.gross.totals.map((t) => [
            t.month,
            t.actual ? 'actual' : 'forecast',
            decimal(t.equityContributionsCents),
            decimal(t.debtDrawsCents),
            decimal(t.principalRepaymentsCents),
            decimal(t.cashInterestCents),
            decimal(t.capitalisedInterestCents),
            decimal(t.feesCents),
            decimal(t.distributionsCents),
            decimal(t.unfundedCents),
            decimal(t.closingCashCents),
            decimal(t.debtClosingCents),
            'AUD',
          ]),
        },
        ...run.result.facilities.map((facility) => ({
          title: `Facility · ${facility.name}`,
          header: ['Month', 'Opening', 'Draws', 'Repayments', 'Capitalised interest', 'Cash interest', 'Fees', 'Closing', 'Unused capacity', 'Breaches', 'Currency'],
          rows: facility.months.map((m) => [m.month, decimal(m.openingCents), decimal(m.drawsCents), decimal(m.repaymentsCents), decimal(m.capitalisedCents), decimal(m.cashInterestCents), decimal(m.feesCents), decimal(m.closingCents), decimal(m.unusedCents), String(m.breaches), 'AUD']),
        })),
      ];
    case 'scenario-comparison': {
      const columns = scenariosService.compare(projectId, input.scenarioIds, basis);
      return [
        {
          title: 'Scenario comparison (variance = scenario − current; ratios in percentage points; dates in days)',
          header: ['Metric', ...columns.flatMap((c) => (c.variances ? [safeText(c.label), `${safeText(c.label)} variance`] : [safeText(c.label)]))],
          rows: COMPARISON_METRICS.map((metric) => [
            COMPARISON_LABELS[metric],
            ...columns.flatMap((column) => {
              const value = column.values[metric];
              const formatted =
                value.value === null ? '' : METRIC_KIND[metric] === 'money' ? decimal(value.value as number) : METRIC_KIND[metric] === 'ratio' ? ((value.value as number) * 100).toFixed(4) : String(value.value);
              if (!column.variances) return [formatted];
              const delta = column.variances[metric];
              const formattedDelta = delta === null ? '' : METRIC_KIND[metric] === 'money' ? decimal(delta) : METRIC_KIND[metric] === 'ratio' ? delta.toFixed(4) : String(delta);
              return [formatted, formattedDelta];
            }),
          ]),
        },
      ];
    }
    case 'investor-distribution': {
      const participants = fundingService.listParticipants(projectId).filter((p) => input.participantId === null || p.id === input.participantId);
      return [
        {
          title: 'Capital accounts',
          header: ['Participant', 'Class', 'Commitment', 'Contributed', 'Capital returned', 'Outstanding capital', 'Preferred accrued', 'Preferred paid', 'Profit distributed', 'IRR to date (%)', 'Currency'],
          rows: participants.map((participant) => {
            const account = fundingService.capitalAccount(participant.id, input.asOf);
            const participantIrr = fundingService.participantIrr(participant.id, input.asOf);
            return [
              safeText(participant.name),
              participant.class,
              decimal(participant.commitment.cents),
              decimal(account.contributed.cents),
              decimal(account.capitalReturned.cents),
              decimal(account.outstanding.cents),
              decimal(account.preferredAccrued.cents),
              decimal(account.preferredPaid.cents),
              decimal(account.profitDistributed.cents),
              irr(participantIrr),
              'AUD',
            ];
          }),
        },
        {
          title: 'Movements',
          header: ['Participant', 'Date', 'Type', 'Basis', 'Amount', 'Currency'],
          rows: participants.flatMap((participant) =>
            fundingService.movementsForParticipant(participant.id).map((movement) => [safeText(participant.name), movement.on, movement.type, movement.basis, decimal(movement.amount.cents), 'AUD']),
          ),
        },
        {
          title: 'Modelled terminal distribution (forecast, from the published waterfall)',
          header: ['Participant', 'Amount', 'Currency'],
          rows: (run.result.terminalDistribution ?? [])
            .filter((row) => input.participantId === null || row.participantId === input.participantId)
            .map((row) => [safeText(participants.find((p) => p.id === row.participantId)?.name ?? row.participantId), decimal(row.cents), 'AUD']),
        },
      ];
    }
  }
}

/** The templates a membership may generate. Investors get their own distribution report only (EQ03). */
export function allowedTemplates(scope: ProjectScope): readonly ReportTemplate[] {
  if (scope.permissions.includes('financials.read')) {
    return ['feasibility-summary', 'monthly-cashflow', 'cost-commitment-register', 'invoice-status-register', 'funding-schedule', 'scenario-comparison', 'investor-distribution'];
  }
  if (scope.permissions.includes('participation.read')) return ['investor-distribution'];
  return [];
}

export const reportsService = {
  list(projectId: ProjectId, scope?: ProjectScope): readonly ReportJob[] {
    const jobs = reportsRepository.list(projectId);
    if (!scope || scope.permissions.includes('financials.read')) return jobs;
    // An investor sees only reports generated for their own participation.
    return jobs.filter((job) => job.participantId !== null && job.participantId === scope.participantId);
  },

  require(id: ReportJobId): ReportJob {
    const job = reportsRepository.find(id);
    if (!job) throw new NotFoundError('Report', id);
    return job;
  },

  /**
   * RPT01/RPT03 — generate a report from a frozen snapshot. The job records
   * queued → running → completed (or failed); a failure keeps its message and
   * never overwrites an earlier successful report.
   */
  generate(input: {
    readonly projectId: ProjectId;
    readonly template: ReportTemplate;
    readonly scope: ProjectScope;
    readonly basis?: 'economic' | 'gross';
    readonly includeSensitive?: boolean;
    readonly scenarioIds?: readonly ScenarioId[];
    readonly asOf: IsoDate;
    readonly actor: UserId;
    readonly retryOf?: ReportJobId;
  }): ReportJob {
    if (!allowedTemplates(input.scope).includes(input.template)) {
      throw new ForbiddenError('This membership cannot generate that report.');
    }
    const canSeeSensitive = input.scope.permissions.includes('sales.edit') || input.scope.permissions.includes('finance.edit') || input.scope.permissions.includes('payment.record');
    if (input.includeSensitive && !canSeeSensitive) {
      throw new ForbiddenError('Supplier and buyer details need an authorised role.');
    }
    const investorOnly = !input.scope.permissions.includes('financials.read');
    const participantId = investorOnly ? input.scope.participantId : null;
    if (investorOnly && !participantId) throw new ForbiddenError('This investor membership is not linked to a participant.');

    const project = projectsService.require(input.projectId);
    const basis = input.basis ?? projectsService.policyFor(project.id).tax.displayBasis;
    const queued: ReportJob = {
      id: asId<'ReportJob'>(`rpt-${randomUUID()}`),
      projectId: project.id,
      template: input.template,
      format: 'csv',
      state: 'queued',
      runId: null,
      scenarioIds: input.scenarioIds ?? [],
      basis,
      includeSensitive: Boolean(input.includeSensitive),
      participantId,
      createdAt: new Date().toISOString(),
      createdBy: input.actor,
      comments: [],
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    };
    reportsRepository.insert(queued);
    reportsRepository.update(queued.id, { state: 'running' });
    try {
      if (input.template === 'scenario-comparison' && (input.scenarioIds ?? []).length === 0) {
        throw new ValidationError('Choose at least one scenario to compare.');
      }
      const run = projectModelService.calculate(project.id, { actor: input.actor, asOf: input.asOf });
      const tables = buildTables({
        template: input.template,
        projectId: project.id,
        run,
        basis,
        includeSensitive: Boolean(input.includeSensitive),
        participantId,
        scenarioIds: input.scenarioIds ?? [],
        asOf: input.asOf,
      });
      const meta = {
        projectCode: project.code,
        projectName: project.name,
        scenarioLabel: input.template === 'scenario-comparison' ? `Current model vs ${(input.scenarioIds ?? []).length} scenario(s)` : 'Current model',
        modelRevision: run.modelRevision,
        engineVersion: run.engineVersion,
        actualsCutoff: run.actualsCutoff,
        taxBasis: basis === 'economic' ? 'Economic (net of recoverable GST)' : 'Gross (cash including GST)',
        generatedAt: new Date().toISOString(),
      };
      const completed = reportsRepository.update(queued.id, {
        state: 'completed',
        runId: run.id,
        meta,
        tables,
        csv: toCsv(queued, meta, tables),
        dataHash: dataHash(tables),
        completedAt: new Date().toISOString(),
      });
      if (!completed) throw new NotFoundError('Report', queued.id);
      accessService.record({
        actor: accessService.resolveUserName(input.actor) ?? 'system',
        summary: `Report generated · ${REPORT_TEMPLATE_LABELS[input.template]}`,
        context: `${project.code} · run rev ${run.modelRevision} · ${basis}${input.includeSensitive ? ' · includes supplier/buyer details' : ''}${participantId ? ' · investor copy' : ''}`,
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Report generation failed.';
      const failed = reportsRepository.update(queued.id, { state: 'failed', error: message, completedAt: new Date().toISOString() });
      accessService.record({
        actor: accessService.resolveUserName(input.actor) ?? 'system',
        summary: `Report failed · ${REPORT_TEMPLATE_LABELS[input.template]}`,
        context: message,
        outcome: 'failed',
      });
      if (error instanceof ForbiddenError || error instanceof ValidationError) throw error;
      return failed ?? queued;
    }
  },

  /** Safe retry of a failed job: a new job, the failed one kept (RPT03). */
  retry(id: ReportJobId, scope: ProjectScope, actor: UserId, asOf: IsoDate): ReportJob {
    const job = reportsService.require(id);
    if (job.state !== 'failed') throw new ConflictError('Only a failed report can be retried.');
    return reportsService.generate({
      projectId: job.projectId,
      template: job.template,
      scope,
      basis: job.basis,
      includeSensitive: job.includeSensitive,
      scenarioIds: job.scenarioIds,
      asOf,
      actor,
      retryOf: job.id,
    });
  },

  /** RPT04 — comments and attachment names append to a completed snapshot; figures are untouched. */
  addComment(id: ReportJobId, text: string, actor: UserId, attachmentName?: string): ReportJob {
    const job = reportsService.require(id);
    if (job.state !== 'completed') throw new ConflictError('Only a completed report can take comments.');
    if (!text.trim()) throw new ValidationError('Write a comment.', { fieldErrors: { text: ['A comment cannot be empty.'] } });
    const updated = reportsRepository.update(id, {
      comments: [...job.comments, { id: `rc-${randomUUID()}`, at: new Date().toISOString(), by: actor, text: text.trim(), ...(attachmentName ? { attachmentName } : {}) }],
    });
    if (!updated) throw new NotFoundError('Report', id);
    return updated;
  },

  /** An expiring link bound to the report and the person it was issued to. */
  issueDownloadLink(id: ReportJobId, userId: UserId, nowMs = Date.now()): { readonly url: string; readonly expiresAt: string } {
    const job = reportsService.require(id);
    if (job.state !== 'completed') throw new ConflictError('The report is not ready to download.');
    const expires = Math.floor(nowMs / 1000) + DOWNLOAD_LINK_SECONDS;
    return {
      url: `/api/v1/reports/${encodeURIComponent(id)}/download?expires=${expires}&signature=${sign(id, userId, expires)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  },

  /** Verify a download link; the caller also rechecks the person's current access. */
  verifyDownload(id: ReportJobId, userId: UserId, expires: number, signature: string, nowMs = Date.now()): ReportJob {
    const job = reportsService.require(id);
    if (!Number.isInteger(expires) || expires * 1000 < nowMs) throw new ForbiddenError('This download link has expired. Generate a new one from Reports.');
    const expected = sign(id, userId, expires);
    if (expected.length !== signature.length || !timingSafeEqualHex(expected, signature)) {
      throw new ForbiddenError('This download link is not valid for you.');
    }
    if (job.state !== 'completed' || !job.csv) throw new ConflictError('The report is not ready to download.');
    return job;
  },

  filename(job: ReportJob): string {
    const date = (job.completedAt ?? job.createdAt).slice(0, 10);
    return `${job.meta?.projectCode ?? 'project'}-${job.template}-${date}.csv`.replace(/[^A-Za-z0-9._-]/g, '-');
  },
};

function timingSafeEqualHex(a: string, b: string): boolean {
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
