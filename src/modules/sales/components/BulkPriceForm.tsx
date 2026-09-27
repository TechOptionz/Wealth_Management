'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Row, Sub } from '@/shared/components/Layout';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';
import { formatMoney } from '@/shared/lib/money';
import { bulkPriceChangeAction } from '../actions';
import type { RevenueGroup } from '../model';
import type { BulkPriceChangeResult } from '../service';

type Value = BulkPriceChangeResult & { readonly preview: boolean };

/**
 * YLD02 — bulk price change with a preview of old and new prices. Contracted
 * units are skipped and listed unless "vary contracts" is ticked, which
 * records a contract variation with history.
 */
export function BulkPriceForm({ projectId, groups, onClose }: { readonly projectId: string; readonly groups: readonly RevenueGroup[]; readonly onClose: () => void }) {
  const [state, formAction, pending] = useActionState(bulkPriceChangeAction, IDLE_RESULT as ActionResult<unknown>);
  const [signature, setSignature] = useState('');
  const router = useRouter();
  const value = state.ok ? (state.value as Value | undefined) : undefined;
  const preview = value?.preview && value ? value : undefined;
  const applied = value && !value.preview ? value : undefined;
  // The preview is valid only for the inputs it was computed from.
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);
  useEffect(() => {
    if (applied) router.refresh();
  }, [applied, router]);

  const ready = preview !== undefined && submittedFor === signature;
  const fieldErrors = (!state.ok ? state.fieldErrors : undefined) ?? {};

  return (
    <Card>
      <CardHeader title="Bulk price change" aside={<Sub>Forecast prices · contracted units skipped by default</Sub>} />
      <CardBody>
        <form
          action={formAction}
          className="stack"
          onSubmit={() => setSubmittedFor(signature)}
          onChange={(event) => {
            const form = event.currentTarget;
            const data = new FormData(form);
            data.delete('preview');
            setSignature(JSON.stringify([...data.entries()]));
          }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="preview" value={ready ? '0' : '1'} />
          <FieldGrid>
            <SelectField id="bp-group" name="groupId" label="Units" defaultValue="" options={[{ value: '', label: 'Every group' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} />
            <SelectField
              id="bp-mode"
              name="mode"
              label="Change"
              defaultValue="percent"
              options={[
                { value: 'percent', label: 'By percentage' },
                { value: 'amount', label: 'By amount' },
                { value: 'set', label: 'Set every price to' },
              ]}
            />
            <TextField id="bp-value" name="value" label="Value" inputMode="decimal" placeholder="2.5 or 5000" invalid={Boolean(fieldErrors.value)} hint={fieldErrors.value?.[0]} />
            <TextField id="bp-reason" name="reason" label="Reason" placeholder="Market review" />
          </FieldGrid>
          <label className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" name="viaContractVariation" />
            Also vary contracted units&apos; contract price (records a contract variation on each)
          </label>

          {!state.ok && state.message ? <Banner tone="warn" title={state.message} /> : null}

          {preview ? (
            <div className="stack">
              <Banner tone="info" icon="i-clock" title={`Preview · ${preview.changes.length} change(s), ${preview.skipped.length} contracted skipped · nothing saved yet`} />
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {preview.changes.map((row) => (
                  <li key={row.unitId}>
                    <b>{row.code}</b>: {formatMoney(row.from)} → {formatMoney(row.to)}
                  </li>
                ))}
                {preview.skipped.map((row) => (
                  <li key={row.unitId}>
                    <Chip tone="warn" icon="i-alert">Skipped</Chip> <b>{row.code}</b> · contracted; changes only through a contract variation
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {applied ? <Banner tone="info" icon="i-check" title={`${applied.changes.length} unit(s) repriced · ${applied.skipped.length} skipped`} /> : null}

          <Row>
            <Button variant={ready ? 'primary' : 'default'} type="submit" disabled={pending}>
              {pending ? 'Working…' : ready ? 'Apply price change' : 'Preview'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </Row>
        </form>
      </CardBody>
    </Card>
  );
}
