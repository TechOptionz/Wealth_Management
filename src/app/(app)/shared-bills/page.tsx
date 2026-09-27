import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { sumMoney } from '@/shared/lib/money';
import { sharedBillsService, type SharedBillFilter } from '@/modules/shared-bills/service';
import { propertiesService } from '@/modules/properties/service';
import { SharedBillsScreen } from '@/modules/shared-bills/components/SharedBillsScreen';
import type { BillAllocation } from '@/modules/shared-bills/model';
import { resolveAsOfDate } from '@/shared/config/app-config';

export const metadata: Metadata = { title: 'Shared bills & recoveries · Holdfast' };

const FILTERS: readonly SharedBillFilter[] = ['all', 'recoverable', 'owner-cost', 'needs-review', 'blocked'];

/** FR-07 — shared bills, their approved splits, and what is recoverable. */
export default async function SharedBillsPage() {
  await loadUnitOfWork();
  const all = sharedBillsService.listAllocations();

  const allocationsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({ ...accumulator, [filter]: sharedBillsService.applyFilter(all, filter) }),
    {} as Record<SharedBillFilter, readonly BillAllocation[]>,
  );

  const propertyNames = Object.fromEntries(
    propertiesService.list().map((property) => [property.id, property.name]),
  );

  return (
    <SharedBillsScreen
      allocationsByFilter={allocationsByFilter}
      counts={sharedBillsService.counts()}
      totalRecovered={sumMoney(all.map((entry) => entry.recovered))}
      totalOwnerExpense={sumMoney(all.map((entry) => entry.ownerExpense))}
      propertyNames={propertyNames}
      today={resolveAsOfDate()}
    />
  );
}
