import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { accessService } from '@/modules/access/service';
import { projectsApi } from '@/modules/projects/api';
import { projectsService } from '@/modules/projects/service';
import { budgetsApi } from '@/modules/budgets/api';
import { programmeService } from '@/modules/programme/service';
import { asId } from '@/shared/types/common';
import { CategoryRegisterScreen, type LineRow } from '@/modules/budgets/components/CategoryRegisterScreen';

export const metadata: Metadata = { title: 'Cost category · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string; readonly categoryId: string }>;
}

/** CST02, CST08, CF03, CF04, CF07 — one category's lines, detail, edits and batch. Amounts ex GST. */
export default async function CostCategoryPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId, categoryId } = await params;

  return renderGuarded(() => {
    const { project, scope } = projectsApi.get(projectId);
    const categories = budgetsApi.listCategories(projectId);
    const category = categories.find((entry) => entry.id === categoryId);
    if (!category) notFound();

    const all = budgetsApi.listCostLines(projectId, {}).items;
    const lines: readonly LineRow[] = all
      .filter((view) => view.line.categoryId === category.id)
      .map((view) => ({
        line: view.line,
        current: view.currentBudget,
        baseline: view.baseline,
        parentCode: view.line.parentLineId ? (all.find((other) => other.line.id === view.line.parentLineId)?.line.code ?? null) : null,
        responsibleName: accessService.resolveUserName(view.line.responsibleUserId),
      }));

    const milestones: readonly { id: string; name: string; plannedDate: string }[] = programmeService
      .listMilestones(asId<'Project'>(projectId))
      .map((milestone) => ({ id: milestone.id, name: milestone.name, plannedDate: programmeService.effectiveDate(milestone) }));

    return (
      <CategoryRegisterScreen
        projectId={project.id}
        revision={project.modelRevision}
        cutoff={projectsService.policyFor(project.id).actualsCutoff}
        category={{ id: category.id, code: category.code, name: category.name }}
        categories={categories.map((entry) => ({ id: entry.id, code: entry.code, name: entry.name }))}
        lines={lines}
        projectLines={all.map((view) => ({
          id: view.line.id,
          code: view.line.code,
          title: view.line.title,
          rowType: view.line.rowType,
          isContingency: view.line.isContingency,
          active: view.line.active,
        }))}
        milestones={milestones}
        people={accessService.listUsers().map((user) => ({ id: user.id, name: user.name }))}
        canEdit={scope.permissions.includes('budget.edit')}
      />
    );
  });
}
