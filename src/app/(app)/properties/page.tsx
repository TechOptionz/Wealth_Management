import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { propertiesService, type PropertyFilter } from '@/modules/properties/service';
import { loansService } from '@/modules/loans/service';
import { leasesService } from '@/modules/leases/service';
import { entitiesService } from '@/modules/entities/service';
import { PropertiesScreen } from '@/modules/properties/components/PropertiesScreen';
import type { PropertyCardProps } from '@/modules/properties/components/PropertyCard';
import type { Property } from '@/modules/properties/model';
import type { IsoDate } from '@/shared/types/common';
import { formatDateShort } from '@/shared/lib/dates';

export const metadata: Metadata = { title: 'Properties & assets · Holdfast' };

const FILTERS: readonly PropertyFilter[] = ['all', 'rented', 'own-home', 'stale-valuation'];

/** Assemble one property's card data from the modules that own each part. */
function toCard(property: Property, asOf: IsoDate): PropertyCardProps {
  const valuation = propertiesService.valuationStatus(property.id, asOf);
  const occupancy = propertiesService.occupancy(property.id, asOf);
  const debt = loansService.debtForProperty(property.id);
  const monthlyRent = leasesService.monthlyRentForProperty(property.id, asOf);
  const arrears = leasesService.arrearsForProperty(property.id, asOf);

  const vacantSince = propertiesService
    .listComponents(property.id)
    .find((component) => component.vacantSince !== undefined)?.vacantSince;

  const rentNote =
    property.status === 'under-construction'
      ? 'Not yet rentable'
      : property.status === 'own-home'
        ? 'Not rented · still an asset'
        : property.rentalMode === 'by-room'
          ? 'Room leases'
          : monthlyRent.cents === 0 && vacantSince
            ? `Lease ended ${formatDateShort(vacantSince)}`
            : 'Whole property lease';

  return {
    property,
    occupancyLabel: propertiesService.occupancyLabel(property.id, asOf),
    occupancy,
    valuation: {
      amount: valuation.valuation?.amount ?? null,
      label: valuation.label,
      isStale: valuation.isStale,
    },
    monthlyRent: property.status === 'own-home' || property.status === 'under-construction' ? null : monthlyRent,
    rentNote,
    debt: debt
      ? {
          amount: debt.amount,
          note: debt.viaPolicy ? `${debt.facilityLabel}` : debt.facilityLabel,
        }
      : null,
    arrears: property.status === 'rented' ? arrears : null,
    lvr: loansService.propertyLvr(property.id, asOf),
  };
}

/** FR-02 — properties, valuations and occupancy. */
export default async function PropertiesPage() {
  await loadUnitOfWork();
  const asOf = resolveAsOfDate();
  const all = propertiesService.list();

  const cardsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({
      ...accumulator,
      [filter]: propertiesService.applyFilter(all, filter, asOf).map((property) => toCard(property, asOf)),
    }),
    {} as Record<PropertyFilter, readonly PropertyCardProps[]>,
  );

  return (
    <PropertiesScreen
      cardsByFilter={cardsByFilter}
      counts={propertiesService.counts(asOf)}
      today={asOf}
      entities={entitiesService.listEntities().map((entity) => ({ id: entity.id, name: entity.name }))}
    />
  );
}
