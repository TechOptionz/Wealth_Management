import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { obligationsService, type ObligationFilter } from '@/modules/obligations/service';
import { propertiesService } from '@/modules/properties/service';
import { entitiesService } from '@/modules/entities/service';
import { ObligationsScreen } from '@/modules/obligations/components/ObligationsScreen';
import { accessService } from '@/modules/access/service';
import { documentsService } from '@/modules/documents/service';
import type { TimelineEntry } from '@/shared/components/Timeline';

export const metadata: Metadata = { title: 'Obligations & reminders · Holdfast' };

const FILTERS: readonly ObligationFilter[] = ['all', 'due-this-week', 'overdue', 'no-owner', 'paid'];

/** FR-03, FR-08 — obligations and their reminder schedules. */
export default async function ObligationsPage() {
  await loadUnitOfWork();
  const asOf = resolveAsOfDate();

  const viewsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({ ...accumulator, [filter]: obligationsService.listViews(asOf, filter) }),
    {} as Record<ObligationFilter, ReturnType<typeof obligationsService.listViews>>,
  );

  const all = viewsByFilter.all;

  const timelines = Object.fromEntries(
    all.map((view) => [
      view.obligation.id,
      obligationsService.reminderTimeline(view.obligation.id, asOf) as readonly TimelineEntry[],
    ]),
  );

  const context = Object.fromEntries(
    all.map((view) => {
      const propertyId = view.obligation.propertyId;
      const property = propertyId ? propertiesService.require(propertyId) : null;
      const owners = propertyId ? entitiesService.ownersOf(propertyId, asOf) : [];
      const firstOwner = owners[0];
      return [
        view.obligation.id,
        {
          propertyName: property?.name.split(',')[0] ?? null,
          entityName: firstOwner ? entitiesService.nameOf(firstOwner.ownerEntityId) : null,
        },
      ];
    }),
  );

  // The design opens with the next obligation carrying a queued reminder.
  const initialSelected =
    all.find((view) => view.status === 'reminder-queued')?.obligation.id ?? all[0]?.obligation.id ?? null;

  return (
    <ObligationsScreen
      viewsByFilter={viewsByFilter}
      counts={obligationsService.counts(asOf)}
      timelines={timelines}
      context={context}
      initialSelectedId={initialSelected}
      today={asOf}
      people={accessService.listAccess().map((row) => ({ id: row.user.id, name: row.user.name }))}
      properties={propertiesService.list().map((property) => ({ id: property.id, name: property.name }))}
      // Receipts and invoices are what evidence a payment; offering the whole
      // register would bury them.
      documents={documentsService
        .list('invoices-receipts')
        .map((view) => ({ id: view.record.id, name: view.record.filename }))}
    />
  );
}
