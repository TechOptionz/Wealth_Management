import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { sumMoney } from '@/shared/lib/money';
import type { UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsApi } from '@/modules/projects/api';
import { budgetsApi } from '@/modules/budgets/api';
import { budgetsService } from '@/modules/budgets/service';
import { baselineTotal } from '@/modules/budgets/model';
import { CostRegisterScreen, type BatchRow, type BaselineRow, type CategorySummaryRow } from '@/modules/budgets/components/CostRegisterScreen';

export const metadata: Metadata = { title: 'Costs · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** CST01, CST08, PRJ05, CF07, CF09 — the project cost register. Every amount is ex GST. */
export default async function CostsPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;

  return renderGuarded(() => {
    const { project, scope } = projectsApi.get(projectId);
    const categories = budgetsApi.listCategories(projectId);
    const views = budgetsApi.listCostLines(projectId, {}).items;
    const baselines = budgetsApi.baselines(projectId);
    const adjustments = budgetsApi.adjustments(projectId);
    const batches = budgetsApi.batches(projectId);
    const selected = budgetsService.selectedBaseline(project.id);
    const name = (id: UserId | undefined): string => accessService.resolveUserName(id) ?? 'system';
    const codeOf = (id: string | undefined): string | null => (id ? (views.find((view) => view.line.id === id)?.line.code ?? id) : null);

    const posting = views.filter((view) => view.line.rowType === 'posting');
    const categoryRows: readonly CategorySummaryRow[] = categories.map((category) => {
      const inCategory = posting.filter((view) => view.line.categoryId === category.id);
      const baselineAmounts = inCategory.flatMap((view) => (view.baseline ? [view.baseline] : []));
      return {
        id: category.id,
        code: category.code,
        name: category.name,
        lineCount: views.filter((view) => view.line.categoryId === category.id).length,
        inactiveCount: inCategory.filter((view) => !view.line.active).length,
        current: sumMoney(inCategory.map((view) => view.currentBudget)),
        baseline: baselineAmounts.length > 0 ? sumMoney(baselineAmounts) : null,
      };
    });

    const baselineRows: readonly BaselineRow[] = [...baselines].reverse().map((version) => ({
      id: version.id,
      name: version.name,
      state: version.state,
      total: baselineTotal(version) ?? sumMoney([]),
      createdAt: version.createdAt,
      createdByName: name(version.createdBy),
      approvedByName: version.approvedBy ? name(version.approvedBy) : null,
      approvedAt: version.approvedAt ?? null,
      reason: version.reason ?? null,
      sourceRevision: version.sourceRevision,
    }));

    const batchRows: readonly BatchRow[] = batches.map((batch) => {
      const codes = [...new Set(batch.changes.map((change) => codeOf(change.costLineId)))].join(', ');
      return {
        id: batch.id,
        actorName: name(batch.actor),
        at: batch.at,
        revisionBefore: batch.revisionBefore,
        revisionAfter: batch.revisionAfter,
        summary: `${batch.changes.length} change${batch.changes.length === 1 ? '' : 's'} · ${codes}`,
        compensates: Boolean(batch.compensatesBatchId),
        undone: Boolean(batch.undoneByBatchId),
      };
    });

    const undo = budgetsService.undoEligibility(project.id, accessService.getCurrentUser().id);

    return (
      <CostRegisterScreen
        projectId={project.id}
        revision={project.modelRevision}
        kpis={{
          postingLines: posting.length,
          inactiveLines: posting.filter((view) => !view.line.active).length,
          categories: categories.length,
          totalCurrent: sumMoney(posting.map((view) => view.currentBudget)),
          baselineName: selected?.name ?? null,
          baselineTotal: baselineTotal(selected),
        }}
        categories={categoryRows}
        baselines={baselineRows}
        adjustments={adjustments.map((adjustment) => ({
          id: adjustment.id,
          kind: adjustment.kind,
          fromCode: codeOf(adjustment.fromLineId),
          toCode: codeOf(adjustment.toLineId),
          amount: adjustment.amount,
          reason: adjustment.reason,
          actorName: name(adjustment.actor),
          at: adjustment.at,
          revision: adjustment.revision,
        }))}
        batches={batchRows}
        undo={{ allowed: undo.batch !== null, reason: undo.reason }}
        permissions={{
          canEdit: scope.permissions.includes('budget.edit'),
          canPublish: scope.permissions.includes('baseline.publish'),
        }}
      />
    );
  });
}
