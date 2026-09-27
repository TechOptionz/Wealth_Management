import { Chip } from '@/shared/components/Chip';
import type { IconName } from '@/shared/components/IconSprite';
import type { Tone } from '@/shared/types/common';
import { REVIEW_STATE_LABELS, SETTLEMENT_STATE_LABELS, type ReviewState, type SettlementState } from '../model';

const REVIEW_TONE: Record<ReviewState, { readonly tone: Tone; readonly icon: IconName }> = {
  received: { tone: 'neutral', icon: 'i-file' },
  'needs-review': { tone: 'warn', icon: 'i-alert' },
  ready: { tone: 'info', icon: 'i-check-sq' },
  'awaiting-approval': { tone: 'gold', icon: 'i-clock' },
  'on-hold': { tone: 'warn', icon: 'i-pause' },
  approved: { tone: 'good', icon: 'i-check' },
  rejected: { tone: 'bad', icon: 'i-x' },
  void: { tone: 'neutral', icon: 'i-x' },
};

const SETTLEMENT_TONE: Record<SettlementState, { readonly tone: Tone; readonly icon: IconName }> = {
  unpaid: { tone: 'neutral', icon: 'i-clock' },
  'part-paid': { tone: 'info', icon: 'i-wallet' },
  paid: { tone: 'good', icon: 'i-check' },
  'credit-due': { tone: 'warn', icon: 'i-alert' },
  reconciled: { tone: 'good', icon: 'i-check-sq' },
};

/** §6.3 review state — icon and words, never colour alone. */
export function ReviewStateChip({ state }: { readonly state: ReviewState }) {
  const style = REVIEW_TONE[state];
  return <Chip tone={style.tone} icon={style.icon}>{REVIEW_STATE_LABELS[state]}</Chip>;
}

/** §6.3 settlement state — derived, never stored. */
export function SettlementChip({ state }: { readonly state: SettlementState }) {
  const style = SETTLEMENT_TONE[state];
  return <Chip tone={style.tone} icon={style.icon}>{SETTLEMENT_STATE_LABELS[state]}</Chip>;
}

/** §6.3 sync state — nothing is queued because no accounting provider is connected (INV11). */
export function SyncChip({ approved = false }: { readonly approved?: boolean }) {
  return (
    <Chip tone="neutral" icon="i-link">
      {approved ? 'Approved · not synced · no accounting connection' : 'Not synced · no connection'}
    </Chip>
  );
}
