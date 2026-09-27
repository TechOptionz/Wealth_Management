import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { reconciliationService } from '@/modules/reconciliation/service';
import { INTERNAL_TRANSFER_ALLOCATION } from '@/modules/reconciliation/model';
import { propertiesService } from '@/modules/properties/service';
import { obligationsService } from '@/modules/obligations/service';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ImportScreen } from '@/modules/reconciliation/components/ImportScreen';
import { UploadStatementForm } from '@/modules/reconciliation/components/UploadStatementForm';
import { formatDateLong, formatDateShort, startOfMonth, toDate } from '@/shared/lib/dates';
import { Card, CardBody } from '@/shared/components/Card';
import { Stack } from '@/shared/components/Layout';

export const metadata: Metadata = { title: 'Bank import & matching · Holdfast' };

/** FR-06 — the import currently in progress. */
export default async function BankImportPage() {
  await loadUnitOfWork();
  const bankImport = reconciliationService.currentImport();

  if (!bankImport) {
    return (
      <Stack>
        <Card>
          <CardBody>
            <p className="sub" style={{ margin: 0 }}>
              No bank import is in progress. Upload a statement to begin.
            </p>
          </CardBody>
        </Card>
        <UploadStatementForm />
      </Stack>
    );
  }

  // "1–31 Aug 2026" within a month; an uploaded statement may straddle two.
  const sameMonth = startOfMonth(bankImport.periodFrom) === startOfMonth(bankImport.periodTo);
  const periodStart = sameMonth
    ? String(toDate(bankImport.periodFrom).getUTCDate())
    : `${formatDateShort(bankImport.periodFrom)} `;
  const periodLabel = `${periodStart}–${sameMonth ? '' : ' '}${formatDateShort(bankImport.periodTo)} ${toDate(
    bankImport.periodTo,
  ).getUTCFullYear()} · ${bankImport.format}`;

  return (
    <ImportScreen
      bankImport={bankImport}
      steps={reconciliationService.stages(bankImport.id)}
      summary={reconciliationService.summarise(bankImport.id)}
      transactions={reconciliationService.listTransactions(bankImport.id)}
      highConfidenceCount={reconciliationService.highConfidenceCount(bankImport.id)}
      readyToPostCount={reconciliationService.readyToPostCount(bankImport.id)}
      periodLabel={periodLabel}
      allocationOptions={[
        ...propertiesService.list().map((property) => ({
          value: `Property · ${property.name}`,
          label: `Property · ${property.name}`,
        })),
        // Titles repeat across properties and years ("Landlord insurance renewal"),
        // and the value is stored as the correction note — so it carries the
        // context and due date to say which obligation was meant.
        ...obligationsService.listViews(resolveAsOfDate(), 'all').slice(0, 12).map((view) => {
          const { title, contextLabel, dueOn } = view.obligation;
          const text = `Obligation · ${title} · ${contextLabel} · due ${formatDateLong(dueOn)}`;
          return { value: text, label: text };
        }),
        { value: INTERNAL_TRANSFER_ALLOCATION, label: INTERNAL_TRANSFER_ALLOCATION },
      ]}
    />
  );
}
