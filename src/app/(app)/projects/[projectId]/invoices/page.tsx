import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { invoicesApi } from '@/modules/invoices/api';
import { InvoicesScreen } from '@/modules/invoices/components/InvoicesScreen';

export const metadata: Metadata = { title: 'Invoices · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly invoice?: string }>;
}

/** INV01–INV15, CST03–CST07, INT07 — register, review, payments & reconciliation, commitments. */
export default async function ProjectInvoicesPage({ params, searchParams }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const { invoice } = await searchParams;

  return renderGuarded(() => <InvoicesScreen workspace={invoicesApi.workspace(projectId)} initialInvoiceId={invoice ?? null} />);
}
