import { redirect } from 'next/navigation';

interface PageProps {
  readonly params: Promise<{ readonly projectId: string; readonly invoiceId: string }>;
}

/** A deep link to one invoice opens the invoices screen on its Review tab. */
export default async function InvoiceDeepLinkPage({ params }: PageProps) {
  const { projectId, invoiceId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}/invoices?invoice=${encodeURIComponent(invoiceId)}`);
}
