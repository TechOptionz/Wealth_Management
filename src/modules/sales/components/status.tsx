import { Chip } from '@/shared/components/Chip';
import type { IconName } from '@/shared/components/IconSprite';
import type { Tone } from '@/shared/types/common';
import { SALES_STATUS_LABELS, type SalesStatus } from '../model';

const STATUS_CHIP: Record<SalesStatus, { readonly tone: Tone; readonly icon: IconName }> = {
  available: { tone: 'neutral', icon: 'i-building' },
  reserved: { tone: 'gold', icon: 'i-clock' },
  exchanged: { tone: 'info', icon: 'i-file' },
  unconditional: { tone: 'info', icon: 'i-check-sq' },
  settled: { tone: 'good', icon: 'i-check' },
  cancelled: { tone: 'bad', icon: 'i-x' },
};

/** Sales status: icon and words, never colour alone. */
export function SalesStatusChip({ status }: { readonly status: SalesStatus }) {
  return (
    <Chip tone={STATUS_CHIP[status].tone} icon={STATUS_CHIP[status].icon}>
      {SALES_STATUS_LABELS[status]}
    </Chip>
  );
}
