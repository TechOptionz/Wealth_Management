import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { formatPpmAsPercent } from '@/shared/finance-engine';
import { asId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { scenariosApi } from '@/modules/scenarios/api';
import { scenariosService } from '@/modules/scenarios/service';
import { describeOverrides } from '@/modules/scenarios/overrides';
import { ScenariosScreen, type ScenarioRow } from '@/modules/scenarios/components/ScenariosScreen';
import { budgetsService } from '@/modules/budgets/service';
import { fundingService } from '@/modules/funding/service';

export const metadata: Metadata = { title: 'Scenarios · Development Finance' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly compare?: string; readonly basis?: string }>;
}

/** SCN01–SCN06 — controlled alternatives to the current model. */
export default async function ScenariosPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const { compare, basis } = await searchParams;

  return renderGuarded(() => {
    const scenarios = scenariosApi.list(projectId);
    const project = projectsService.require(asId<'Project'>(projectId));
    const scope = projectsService.guard(project.id, 'financials.read');
    const requested = (compare ?? '').split(',').filter((id) => scenarios.some((s) => s.id === id)).slice(0, 3);
    const selectedIds = requested.length > 0 ? requested : scenarios.filter((s) => s.state !== 'archived').slice(0, 3).map((s) => s.id);
    const comparison = scenariosApi.compare(projectId, selectedIds, basis === 'gross' ? 'gross' : 'economic');

    const rows: ScenarioRow[] = scenarios.map((scenario) => {
      const latest = scenario.versions[scenario.versions.length - 1];
      const preview = scenario.state === 'draft' ? scenariosService.publishPreview(scenario.id) : { changes: [], notPromoted: [] };
      return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        state: scenario.state,
        assumptions: describeOverrides(scenario.overrides),
        version: latest?.version ?? 1,
        baseRevision: latest?.baseRevision ?? 0,
        actualsCutoff: latest?.actualsCutoff ?? '',
        stale: scenariosService.isStale(scenario),
        history: scenario.versions.map((v) => `v${v.version} · ${v.at.slice(0, 10)} · ${accessService.resolveUserName(v.by) ?? 'system'} · ${v.reason}`),
        publishPreview: { changes: preview.changes, notPromoted: preview.notPromoted },
        publishedChanges: scenario.publishedChanges ?? [],
      };
    });

    return (
      <ScenariosScreen
        projectId={projectId}
        scenarios={rows}
        comparison={comparison}
        selectedIds={selectedIds}
        categories={budgetsService.listCategories(project.id).map((c) => ({ id: c.id, name: c.name }))}
        facilities={fundingService.listFacilities(project.id).map((f) => ({ id: f.id, name: f.name, rateLabel: formatPpmAsPercent(f.rateSteps[f.rateSteps.length - 1]?.ratePpm ?? 0) }))}
        permissions={{ canEdit: scope.permissions.includes('budget.edit'), canPublish: scope.permissions.includes('scenario.publish') }}
        currentRevision={project.modelRevision}
      />
    );
  });
}
