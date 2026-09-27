import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { accessApi } from '@/modules/access/api';
import { propertiesService } from '@/modules/properties/service';
import { AccessScreen } from '@/modules/access/components/AccessScreen';
import { renderGuarded } from '@/shared/components/AccessDenied';
import type { TimelineEntry } from '@/shared/components/Timeline';

export const metadata: Metadata = { title: 'Access & audit · Holdfast' };

/** NFR-01, NFR-03 — who can see what, and what has happened. */
export default async function AccessPage() {
  await loadUnitOfWork();
  return renderGuarded(accessView);
}

/** Called as a plain function, not rendered, so the guard throws inside `renderGuarded`. */
function accessView() {
  const overview = accessApi.getOverview();

  const auditEntries: readonly TimelineEntry[] = overview.auditEvents.map((event) => ({
    id: event.id,
    state: event.outcome === 'failed' ? 'fail' : 'done',
    title: event.summary,
    meta: event.context,
  }));

  return (
    <AccessScreen
      people={overview.people}
      auditEntries={auditEntries}
      continuity={overview.continuity}
      canSeePeople={overview.canSeePeople}
      canSeeAudit={overview.canSeeAudit}
      canInvite={overview.canInvite}
      // The property picker only serves the invite form, so nobody else receives the list.
      properties={
        overview.canInvite
          ? propertiesService.list().map((property) => ({ id: property.id, name: property.name }))
          : []
      }
    />
  );
}
