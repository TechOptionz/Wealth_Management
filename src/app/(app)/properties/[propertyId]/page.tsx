import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { notFound } from 'next/navigation';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { propertiesService } from '@/modules/properties/service';
import { leasesService } from '@/modules/leases/service';
import { leasesRepository } from '@/modules/leases/repository';
import { propertyLinksService } from '@/modules/dashboard/property-links';
import { PropertyDetail, type RoomRow } from '@/modules/properties/components/PropertyDetail';
import { FREQUENCY_LABELS } from '@/modules/leases/model';
import { formatDateCompact, formatDateLong, formatDateShort } from '@/shared/lib/dates';
import { asId } from '@/shared/types/common';
import { isAppError } from '@/shared/lib/errors';

export const metadata: Metadata = { title: 'Property · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly propertyId: string }>;
}

/** FR-02 — one property, its components, their leases and every linked record. */
export default async function PropertyDetailPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { propertyId } = await params;
  const asOf = resolveAsOfDate();

  let property;
  try {
    property = propertiesService.require(asId<'Property'>(propertyId));
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const leases = leasesRepository.listForProperty(property.id);

  const rooms: readonly RoomRow[] = propertiesService.listComponents(property.id).map((component) => {
    const lease = leases.find((entry) => entry.componentId === component.id && entry.endsOn >= asOf);
    if (!lease) {
      return {
        componentId: component.id,
        label: component.label,
        tenantName: null,
        vacantSinceLabel: component.vacantSince ? formatDateShort(component.vacantSince) : null,
        termLabel: null,
        rent: null,
        frequencyLabel: null,
        balance: null,
        state: null,
      };
    }
    const position = leasesService.arrearsFor(lease.id, asOf);
    return {
      componentId: component.id,
      label: component.label,
      tenantName: position.tenantName,
      vacantSinceLabel: null,
      termLabel: `${formatDateCompact(lease.startsOn)} – ${formatDateCompact(lease.endsOn)}`,
      rent: lease.rent,
      frequencyLabel: FREQUENCY_LABELS[lease.frequency],
      balance: leasesService.balanceForLease(lease.id, asOf),
      state: position.state,
    };
  });

  const valuation = propertiesService.valuationStatus(property.id, asOf);
  const links = propertyLinksService.forProperty(property.id, asOf);

  return (
    <PropertyDetail
      title={property.fullAddress}
      name={property.name}
      status={property.status}
      rentalMode={property.rentalMode}
      holdingNote={property.holdingNote}
      rooms={rooms}
      overview={links.overview}
      valuations={links.valuations}
      loans={links.loans}
      obligations={links.obligations}
      documents={links.documents}
      componentNoun={property.rentalMode === 'by-room' ? 'Room' : 'Component'}
      valuationDetail={propertiesService.valuationDetailLabel(property.id, asOf)}
      valuationAmount={valuation.valuation?.amount ?? null}
      capitalGrowth={propertiesService.capitalGrowth(property.id, asOf)}
      settledOnLabel={property.settledOn ? formatDateLong(property.settledOn) : null}
      propertyId={property.id}
      today={asOf}
    />
  );
}
