import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { salesApi } from '@/modules/sales/api';
import { RevenueGroupsScreen } from '@/modules/sales/components/RevenueScreens';

export const metadata: Metadata = { title: 'Revenue register · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** YLD06, REV01 — revenue groups with their totals. */
export default async function RevenuePage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  return renderGuarded(() => <RevenueGroupsScreen projectId={projectId} groups={salesApi.revenueGroups(projectId)} />);
}
