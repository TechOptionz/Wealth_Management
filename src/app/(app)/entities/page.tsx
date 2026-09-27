import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { entitiesService, type EntityFilter } from '@/modules/entities/service';
import { propertiesService } from '@/modules/properties/service';
import { dashboardService } from '@/modules/dashboard/service';
import { EntitiesScreen } from '@/modules/entities/components/EntitiesScreen';
import type { EntityRow } from '@/modules/entities/components/EntityList';

export const metadata: Metadata = { title: 'Entities & ownership · Holdfast' };

const FILTERS: readonly EntityFilter[] = ['all', 'individual', 'company', 'trust', 'smsf'];

/** FR-01, BR-02 — the ownership graph. */
export default async function EntitiesPage() {
  await loadUnitOfWork();
  const asOf = resolveAsOfDate();

  // Consolidated net positions come from the dashboard module, which owns the
  // BR-02 roll-up; this page only presents them.
  const positions = new Map(dashboardService.ownershipPositions(asOf).map((position) => [position.entityId, position]));

  const rowsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({
      ...accumulator,
      [filter]: entitiesService.listWithRelationships(asOf, filter).map<EntityRow>((entry) => ({
        entry,
        value:
          entry.entity.consolidation === 'look-through'
            ? positions.get(entry.entity.id)?.net ?? null
            : null,
      })),
    }),
    {} as Record<EntityFilter, readonly EntityRow[]>,
  );

  // The breakdown card switches entity on the client, so every balance sheet is
  // computed here once rather than fetched per click.
  const holdingsByEntity = Object.fromEntries(
    entitiesService.listEntities().map((entity) => [entity.id, dashboardService.entityHoldings(entity.id, asOf)]),
  );

  // Options for the "Add relationship" form. Properties sit above entities in
  // the dependency order, so the page composes them rather than the module.
  const entities = entitiesService.listEntities().map((entity) => ({ id: entity.id, name: entity.name }));
  const properties = propertiesService.list().map((property) => ({ id: property.id, name: property.name }));

  return (
    <EntitiesScreen
      rowsByFilter={rowsByFilter}
      counts={entitiesService.countByKind()}
      holdingsByEntity={holdingsByEntity}
      entities={entities}
      properties={properties}
      today={asOf}
    />
  );
}
