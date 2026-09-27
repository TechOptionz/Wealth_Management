import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { leasesService, type LeaseFilter, type LeaseView } from '@/modules/leases/service';
import { LeasesScreen } from '@/modules/leases/components/LeasesScreen';
import { leasesRepository } from '@/modules/leases/repository';
import { propertiesService } from '@/modules/properties/service';
import { PROPERTY_IDS, COMPONENT_IDS } from '@/modules/properties/data/seed';

export const metadata: Metadata = { title: 'Leases & tenants · Holdfast' };

const FILTERS: readonly LeaseFilter[] = ['active', 'ending-soon', 'ended'];

/** FR-05 — leases and tenants. */
export default async function LeasesPage() {
  await loadUnitOfWork();
  const asOf = resolveAsOfDate();

  const viewsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({ ...accumulator, [filter]: leasesService.listViews(asOf, filter) }),
    {} as Record<LeaseFilter, readonly LeaseView[]>,
  );

  return (
    <LeasesScreen
      viewsByFilter={viewsByFilter}
      counts={leasesService.counts(asOf)}
      newLease={{
        // Room 6 is the vacancy the prototype points this form at.
        targetLabel: 'Room 6 · 166 Compton Rd',
        propertyId: PROPERTY_IDS.comptonRd,
        componentId: COMPONENT_IDS.comptonRoom6,
        suggestedReference: '166C-R6',
        defaultStartsOn: '2026-09-15',
        defaultEndsOn: '2027-09-14',
        defaultRent: '340.00',
        defaultBond: '1360.00',
        pendingPolicies: { bondHandling: true, proration: true },
        tenants: leasesRepository.listTenants().map((tenant) => ({ id: tenant.id, name: tenant.name })),
      }}
      properties={propertiesService.list().map((property) => ({ id: property.id, name: property.name }))}
      today={asOf}
      outstandingByLease={Object.fromEntries(
        leasesService.list().map((lease) => [lease.id, leasesService.arrearsFor(lease.id, asOf).outstanding]),
      )}
    />
  );
}
