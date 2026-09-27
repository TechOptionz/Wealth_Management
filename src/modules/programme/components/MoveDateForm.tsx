'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button';
import { Chip } from '@/shared/components/Chip';
import { FieldGrid, TextField } from '@/shared/components/Field';
import { Row, Sub } from '@/shared/components/Layout';
import { Banner } from '@/shared/components/Banner';
import { formatDateShort } from '@/shared/lib/dates';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';
import { applyMoveAction, type MoveActionValue } from '../actions';
import { MOVE_BLOCK_LABELS } from '../model';

export interface MoveDateFormProps {
  readonly projectId: string;
  readonly milestoneId: string;
  readonly currentDate: string;
  readonly revision: number;
  readonly hasActual: boolean;
  /**
   * The financial effect of the previewed move (PRG03), supplied by the page
   * because the calculation lives in a module above this one.
   */
  readonly previewFinancials?: (projectId: string, milestoneId: string, newPlannedDate: string) => Promise<ActionResult<FinancialEffect>>;
}

/** What moving the dates would do to money — the shape `project-model` returns. */
export interface FinancialEffect {
  readonly costLinesMoved: readonly { readonly code: string; readonly title: string; readonly monthsChanged: number }[];
  readonly settlementReceiptsMoved: number;
  readonly before: EffectFigures;
  readonly after: EffectFigures;
}

interface EffectFigures {
  readonly peakDebtCents: number;
  readonly financeCostCents: number;
  readonly fundingGapCents: number;
  readonly completionDate: string;
  readonly profitCents: number;
}

/**
 * PRG03 — two-step move. The first submit previews the finish-to-start
 * cascade (nothing is written); the second, with a reason, applies every move
 * as one model revision. Blocked items are shown so their resolution is a
 * deliberate choice, not a silent skip.
 */
export function MoveDateForm({ projectId, milestoneId, currentDate, revision, hasActual, previewFinancials }: MoveDateFormProps) {
  const [state, formAction, pending] = useActionState(applyMoveAction, IDLE_RESULT as ActionResult<unknown>);
  const [newDate, setNewDate] = useState(currentDate);
  const router = useRouter();
  const value = state.ok ? (state.value as MoveActionValue | undefined) : undefined;
  const preview = value?.mode === 'preview' && value.newPlannedDate === newDate ? value : undefined;
  const applied = value?.mode === 'applied' ? value : undefined;

  useEffect(() => {
    if (applied) router.refresh();
  }, [applied, router]);

  const [effect, setEffect] = useState<{ readonly date: string; readonly value: FinancialEffect | null; readonly error: string | null } | null>(null);
  useEffect(() => {
    if (!preview || !previewFinancials) return undefined;
    let cancelled = false;
    void previewFinancials(projectId, milestoneId, preview.newPlannedDate).then((result) => {
      if (cancelled) return;
      setEffect({ date: preview.newPlannedDate, value: result.ok ? (result.value ?? null) : null, error: result.ok ? null : result.message });
    });
    return () => {
      cancelled = true;
    };
  }, [preview, previewFinancials, projectId, milestoneId]);
  const shownEffect = preview && effect?.date === preview.newPlannedDate ? effect : null;

  if (hasActual) {
    return (
      <Banner tone="info" icon="i-check" title="This item has an actual date">
        Recorded actuals are facts; the plan no longer moves them. Dependent items follow the actual.
      </Banner>
    );
  }

  const fieldErrors = (!state.ok ? state.fieldErrors : undefined) ?? {};

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <input type="hidden" name="revision" value={String(revision)} />
      <input type="hidden" name="preview" value={preview ? '0' : '1'} />
      <FieldGrid>
        <TextField id="mv-date" name="newPlannedDate" label="New planned date" type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} />
        <TextField
          id="mv-reason"
          name="reason"
          label="Reason"
          placeholder="Why the date is moving"
          invalid={Boolean(fieldErrors.reason)}
          hint={fieldErrors.reason?.[0] ?? (preview ? 'Required to apply the move' : 'Preview first; a reason is needed to apply')}
        />
      </FieldGrid>

      {!state.ok && state.message ? (
        <Banner tone="warn" title={state.message} />
      ) : null}

      {preview ? (
        <div className="stack">
          <Banner tone="info" icon="i-clock" title={`Preview · ${preview.moves.length} item(s) move, ${preview.blocked.length} blocked · nothing saved yet`}>
            Applying saves every move below as one model revision.
          </Banner>
          {previewFinancials ? (
            shownEffect?.value ? (
              <FinancialEffectSummary effect={shownEffect.value} />
            ) : shownEffect?.error ? (
              <Banner tone="warn" title={`Financial effect unavailable: ${shownEffect.error}`} />
            ) : (
              <Sub>Calculating the financial effect…</Sub>
            )
          ) : null}
          {preview.moves.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {preview.moves.map((move) => (
                <li key={move.milestoneId}>
                  <b>{move.name}</b>: {formatDateShort(move.from)} → {formatDateShort(move.to)}
                </li>
              ))}
            </ul>
          ) : (
            <Sub>No dates change.</Sub>
          )}
          {preview.blocked.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {preview.blocked.map((item) => (
                <li key={item.milestoneId}>
                  <Chip tone="warn" icon="i-alert">Blocked</Chip> <b>{item.name}</b> · {MOVE_BLOCK_LABELS[item.reason]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {applied ? (
        <Banner tone="info" icon="i-check" title={`Moved ${applied.batchMoves.length} item(s) · model revision ${applied.revision}`}>
          {applied.blocked.length > 0 ? `${applied.blocked.length} item(s) stayed where they were and need explicit resolution.` : 'Every dependent date moved together.'}
        </Banner>
      ) : null}

      <Row>
        <Button variant={preview ? 'primary' : 'default'} type="submit" disabled={pending || newDate === currentDate}>
          {pending ? 'Working…' : preview ? 'Apply move' : 'Preview move'}
        </Button>
        {preview ? <Sub style={{ fontSize: 12 }}>Change the date to preview again.</Sub> : null}
      </Row>
    </form>
  );
}

function dollars(cents: number): string {
  return `${cents < 0 ? '−' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-AU')}`;
}

function change(before: number, after: number, higherIsWorse: boolean): string {
  const delta = after - before;
  if (delta === 0) return 'no change';
  const worse = higherIsWorse ? delta > 0 : delta < 0;
  return `${delta > 0 ? '+' : '−'}${dollars(Math.abs(delta))} ${delta > 0 ? '▲' : '▼'} ${worse ? 'adverse' : 'favourable'}`;
}

/** Before and after for the figures a date move affects (PRG03). */
function FinancialEffectSummary({ effect }: { readonly effect: FinancialEffect }) {
  const rows: readonly (readonly [string, string, string, string])[] = [
    ['Development profit', dollars(effect.before.profitCents), dollars(effect.after.profitCents), change(effect.before.profitCents, effect.after.profitCents, false)],
    ['Finance costs', dollars(effect.before.financeCostCents), dollars(effect.after.financeCostCents), change(effect.before.financeCostCents, effect.after.financeCostCents, true)],
    ['Peak debt', dollars(effect.before.peakDebtCents), dollars(effect.after.peakDebtCents), change(effect.before.peakDebtCents, effect.after.peakDebtCents, true)],
    ['Funding gap', dollars(effect.before.fundingGapCents), dollars(effect.after.fundingGapCents), change(effect.before.fundingGapCents, effect.after.fundingGapCents, true)],
    ['Completion', effect.before.completionDate, effect.after.completionDate, effect.before.completionDate === effect.after.completionDate ? 'no change' : 'moved'],
  ];
  return (
    <div className="stack">
      <div className="tbl-wrap">
        <table>
          <caption className="sr">Financial effect of the move</caption>
          <thead>
            <tr>
              <th>Figure</th>
              <th className="r">Now</th>
              <th className="r">After the move</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, before, after, delta]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="r num">{before}</td>
                <td className="r num">{after}</td>
                <td>{delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sub style={{ fontSize: 12 }}>
        {effect.costLinesMoved.length} cost line(s) re-timed
        {effect.costLinesMoved.length > 0 ? ` (${effect.costLinesMoved.slice(0, 5).map((line) => line.code).join(', ')})` : ''} ·{' '}
        {effect.settlementReceiptsMoved} revenue month(s) changed · settled actuals and closed periods never move.
      </Sub>
    </div>
  );
}
