import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { assistantApi } from '@/modules/assistant/api';
import { assistantEnabled } from '@/modules/assistant/service';
import { AssistantScreen } from '@/modules/assistant/components/AssistantScreen';

export const metadata: Metadata = { title: 'Assistant · Development Finance' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** AI01–AI08 — permission-aware financial assistance. */
export default async function AssistantPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  return renderGuarded(() => (
    <AssistantScreen
      projectId={projectId}
      history={assistantApi.history(projectId)}
      enabled={assistantEnabled()}
      suggestions={['Which costs are over baseline?', 'When will cash be needed?', 'Which invoices are awaiting approval?', 'Compare the scenarios', 'How is expected final cost calculated?']}
    />
  ));
}
