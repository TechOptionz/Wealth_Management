import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { documentsService, type DocumentView } from '@/modules/documents/service';
import { DocumentsScreen } from '@/modules/documents/components/DocumentsScreen';
import type { DocumentFilter } from '@/modules/documents/model';
import { propertiesService } from '@/modules/properties/service';
import { entitiesService } from '@/modules/entities/service';
import { obligationsService } from '@/modules/obligations/service';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { firstParam } from '@/shared/lib/search-params';

export const metadata: Metadata = { title: 'Documents · Holdfast' };

const FILTERS: readonly DocumentFilter[] = [
  'all',
  'leases',
  'insurance',
  'invoices-receipts',
  'loans',
  'valuations',
  'unlinked',
];

interface PageProps {
  /** `?document=<id>` highlights that document — where a search result lands. */
  readonly searchParams: Promise<{ readonly document?: string | readonly string[] }>;
}

/** FR-04 — document register with linkage and versions. */
export default async function DocumentsPage({ searchParams }: PageProps) {
  await loadUnitOfWork();
  const focusDocumentId = firstParam((await searchParams).document);
  const rowsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({ ...accumulator, [filter]: documentsService.list(filter) }),
    {} as Record<DocumentFilter, readonly DocumentView[]>,
  );

  // `type:id:label` — the link needs all three, so the option carries all three.
  const linkTargets = [
    ...propertiesService.list().map((p) => ({ value: `property:${p.id}:${p.name}`, label: `Property · ${p.name}` })),
    ...entitiesService.listEntities().map((e) => ({ value: `entity:${e.id}:${e.name}`, label: `Entity · ${e.name}` })),
    ...obligationsService
      .listViews(resolveAsOfDate(), 'all')
      .slice(0, 15)
      .map((v) => ({
        value: `obligation:${v.obligation.id}:${v.obligation.title}`,
        label: `Obligation · ${v.obligation.title}`,
      })),
  ];

  return (
    <DocumentsScreen
      key={focusDocumentId ?? 'none'}
      focusDocumentId={focusDocumentId}
      rowsByFilter={rowsByFilter}
      counts={documentsService.counts()}
      linkTargets={linkTargets}
    />
  );
}
