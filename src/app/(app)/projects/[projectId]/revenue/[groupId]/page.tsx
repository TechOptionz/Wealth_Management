import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { isAppError } from '@/shared/lib/errors';
import { salesApi } from '@/modules/sales/api';
import { RevenueGroupScreen } from '@/modules/sales/components/RevenueScreens';

export const metadata: Metadata = { title: 'Revenue group · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string; readonly groupId: string }>;
}

/** YLD06 — one revenue group's units and actual events. */
export default async function RevenueGroupPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId, groupId } = await params;
  return renderGuarded(() => {
    try {
      return <RevenueGroupScreen projectId={projectId} detail={salesApi.revenueGroup(projectId, groupId)} />;
    } catch (error) {
      if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    }
  });
}
