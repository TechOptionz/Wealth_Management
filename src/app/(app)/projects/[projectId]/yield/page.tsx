import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { salesApi } from '@/modules/sales/api';
import { YieldScreen } from '@/modules/sales/components/YieldScreen';

export const metadata: Metadata = { title: 'Yield · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** YLD01–YLD06, REV01 — unit register, contracts, deposits, other income and commission. */
export default async function YieldPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  return renderGuarded(() => <YieldScreen overview={salesApi.yieldOverview(projectId)} today={resolveAsOfDate()} />);
}
