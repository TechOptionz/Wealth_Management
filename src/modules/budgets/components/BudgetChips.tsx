import { Chip } from '@/shared/components/Chip';
import type { Money } from '@/shared/lib/money';
import { BUDGET_VERSION_STATE_LABELS, varianceWords, type BudgetVersionState } from '../model';

/**
 * Variance against the selected baseline, in words with an icon (UI02). Over
 * baseline is adverse for a cost; under is shown as information, not as
 * "good", because underspend can mean missing scope.
 */
export function VarianceChip({ current, baseline }: { readonly current: Money; readonly baseline: Money | null }) {
  const variance = varianceWords(current, baseline);
  if (variance.amount === null) return <Chip tone="neutral">No baseline</Chip>;
  if (variance.amount.cents === 0) return <Chip tone="neutral" icon="i-check">On baseline</Chip>;
  return variance.adverse ? (
    <Chip tone="bad" icon="i-up">{variance.text}</Chip>
  ) : (
    <Chip tone="info" icon="i-down">{variance.text}</Chip>
  );
}

export function BaselineStateChip({ state }: { readonly state: BudgetVersionState }) {
  if (state === 'published') return <Chip tone="gold" icon="i-check">{BUDGET_VERSION_STATE_LABELS[state]}</Chip>;
  if (state === 'superseded') return <Chip tone="neutral" icon="i-clock">{BUDGET_VERSION_STATE_LABELS[state]}</Chip>;
  return <Chip tone="warn" icon="i-pause">{BUDGET_VERSION_STATE_LABELS[state]}</Chip>;
}

export function RowTypeChip({ rowType }: { readonly rowType: 'posting' | 'summary' }) {
  return rowType === 'summary' ? (
    <Chip tone="neutral" icon="i-grid">Summary · not added</Chip>
  ) : (
    <Chip tone="neutral" icon="i-check">Posting</Chip>
  );
}

/** Cents → "1860.00" for a form's default value. */
export function centsToInput(cents: number): string {
  const magnitude = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}
