import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { expensesService, type ExpenseFilter } from '@/modules/expenses/service';
import { propertiesService } from '@/modules/properties/service';
import { entitiesService } from '@/modules/entities/service';
import { accessService } from '@/modules/access/service';
import { documentsService } from '@/modules/documents/service';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ExpensesScreen } from '@/modules/expenses/components/ExpensesScreen';
import type { ExpenseView } from '@/modules/expenses/model';

export const metadata: Metadata = { title: 'Expenses · Holdfast' };

const FILTERS: readonly ExpenseFilter[] = ['all', 'corrected', 'no-evidence', 'estimated', 'voided'];

/** FR-04 — the expense register with versioned corrections. */
export default async function ExpensesPage() {
  await loadUnitOfWork();
  const all = expensesService.query({ includeVoided: true }).map((view) => view);

  const viewsByFilter = FILTERS.reduce(
    (accumulator, filter) => ({ ...accumulator, [filter]: expensesService.applyFilter(all, filter) }),
    {} as Record<ExpenseFilter, readonly ExpenseView[]>,
  );

  return (
    <ExpensesScreen
      viewsByFilter={viewsByFilter}
      counts={expensesService.counts()}
      total={expensesService.total()}
      byCategory={expensesService.totalsByCategory()}
      propertyNames={Object.fromEntries(propertiesService.list().map((p) => [p.id, p.name]))}
      entityNames={Object.fromEntries(entitiesService.listEntities().map((e) => [e.id, e.name]))}
      userNames={Object.fromEntries(accessService.listAccess().map((row) => [row.user.id, row.user.name]))}
      today={resolveAsOfDate()}
      documents={documentsService
        .list('invoices-receipts')
        .slice(0, 40)
        .map((view) => ({ id: view.record.id, name: view.record.filename }))}
    />
  );
}
