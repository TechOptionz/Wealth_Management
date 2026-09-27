'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import { Chip } from '@/shared/components/Chip';
import { Row, Sub } from '@/shared/components/Layout';
import { formatMoney, money, type Money } from '@/shared/lib/money';
import { TAX_TREATMENT_LABELS, TAX_TREATMENTS, type TaxTreatment } from '@/shared/finance-engine';

export interface EditorOption {
  readonly id: string;
  readonly label: string;
}

export interface CommitmentOption extends EditorOption {
  readonly stages: readonly { readonly id: string; readonly name: string }[];
}

export interface AllocationDraft {
  readonly costLineId: string;
  readonly commitmentId: string;
  readonly stageId: string;
  readonly net: string;
  readonly tax: string;
  readonly treatment: TaxTreatment;
  readonly allowance: string;
}

export const EMPTY_ROW: AllocationDraft = { costLineId: '', commitmentId: '', stageId: '', net: '', tax: '', treatment: 'standard-gst', allowance: '' };

/** "1,860.50" → 186050 cents; blank or unreadable → 0 (the server re-validates). */
export function toCents(raw: string): number {
  const parsed = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function centsToInput(value: Money): string {
  return (value.cents / 100).toFixed(2);
}

const SELECTABLE_TREATMENTS = TAX_TREATMENTS.filter((treatment) => treatment !== 'margin-scheme');

/**
 * No control here is ever `disabled`: a disabled control is left out of the
 * submitted FormData, which would misalign the repeated row arrays.
 *
 * INV06 — repeated allocation rows across cost lines, commitment stages and
 * tax treatments, with running totals against the invoice. Inputs carry
 * repeated names (`allocCostLineId`, `allocNet`, …) that the Server Action
 * reads with `getAll`.
 */
export function AllocationsEditor({
  idPrefix,
  initial,
  costLines,
  commitments,
  invoiceNet,
  invoiceTax,
  invalid,
}: {
  readonly idPrefix: string;
  readonly initial: readonly AllocationDraft[];
  readonly costLines: readonly EditorOption[];
  readonly commitments: readonly CommitmentOption[];
  readonly invoiceNet: number;
  readonly invoiceTax: number;
  readonly invalid?: string;
}) {
  const [rows, setRows] = useState<readonly AllocationDraft[]>(initial.length > 0 ? initial : [EMPTY_ROW]);
  const update = (index: number, patch: Partial<AllocationDraft>): void =>
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  const allocatedNet = rows.reduce((sum, row) => sum + toCents(row.net), 0);
  const allocatedTax = rows.reduce((sum, row) => sum + toCents(row.tax), 0);
  const netDiff = invoiceNet - allocatedNet;
  const taxDiff = invoiceTax - allocatedTax;
  const balanced = netDiff === 0 && taxDiff === 0;

  return (
    <div className="stack" style={{ gridColumn: '1 / -1' }}>
      <div className="tbl-wrap">
        <table className="stack-m">
          <thead>
            <tr>
              <th>Cost line</th>
              <th>Commitment · stage</th>
              <th>Tax treatment</th>
              <th className="r">Net</th>
              <th className="r">GST</th>
              <th>Direct spend</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const commitment = commitments.find((option) => option.id === row.commitmentId);
              return (
                <tr key={index}>
                  <td data-l="Cost line">
                    <div className="field">
                      <select aria-label={`Row ${index + 1} cost line`} id={`${idPrefix}-line-${index}`} name="allocCostLineId" value={row.costLineId} onChange={(event) => update(index, { costLineId: event.target.value })}>
                        <option value="">Choose…</option>
                        {costLines.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td data-l="Commitment">
                    <div className="field">
                      <select aria-label={`Row ${index + 1} commitment`} name="allocCommitmentId" value={row.commitmentId} onChange={(event) => update(index, { commitmentId: event.target.value, stageId: '' })}>
                        <option value="">Direct spend (no commitment)</option>
                        {commitments.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                      <select aria-label={`Row ${index + 1} stage`} name="allocStageId" value={row.stageId} onChange={(event) => update(index, { stageId: event.target.value })}>
                        <option value="">{commitment && commitment.stages.length > 0 ? 'Choose a stage…' : 'No stages'}</option>
                        {(commitment?.stages ?? []).map((stage) => (
                          <option key={stage.id} value={stage.id}>{stage.name}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td data-l="Tax treatment">
                    <div className="field">
                      <select aria-label={`Row ${index + 1} tax treatment`} name="allocTreatment" value={row.treatment} onChange={(event) => update(index, { treatment: event.target.value as TaxTreatment })}>
                        {SELECTABLE_TREATMENTS.map((treatment) => (
                          <option key={treatment} value={treatment}>{TAX_TREATMENT_LABELS[treatment]}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td data-l="Net" className="r">
                    <div className="field">
                      <input aria-label={`Row ${index + 1} net`} name="allocNet" inputMode="decimal" value={row.net} onChange={(event) => update(index, { net: event.target.value })} />
                    </div>
                  </td>
                  <td data-l="GST" className="r">
                    <div className="field">
                      <input aria-label={`Row ${index + 1} GST`} name="allocTax" inputMode="decimal" value={row.tax} onChange={(event) => update(index, { tax: event.target.value })} />
                    </div>
                  </td>
                  <td data-l="Direct spend">
                    <div className="field">
                      <select aria-label={`Row ${index + 1} allowance treatment`} name="allocAllowance" value={row.allowance} onChange={(event) => update(index, { allowance: event.target.value })}>
                        <option value="">{row.commitmentId ? 'Against commitment' : 'Choose…'}</option>
                        {row.commitmentId ? null : <option value="consume-allowance">Consumes line allowance</option>}
                        {row.commitmentId ? null : <option value="additional-scope">Additional scope</option>}
                      </select>
                    </div>
                  </td>
                  <td>
                    <Button small variant="ghost" onClick={() => setRows((current) => current.filter((_, position) => position !== index))} disabled={rows.length === 1} aria-label={`Remove row ${index + 1}`}>
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button small onClick={() => setRows((current) => [...current, EMPTY_ROW])}>+ Add allocation row</Button>
        <Row>
          <Sub>
            Allocated net {formatMoney(money(allocatedNet), { showCents: true })} of {formatMoney(money(invoiceNet), { showCents: true })} · GST{' '}
            {formatMoney(money(allocatedTax), { showCents: true })} of {formatMoney(money(invoiceTax), { showCents: true })}
          </Sub>
          {balanced ? (
            <Chip tone="good" icon="i-check">Balanced</Chip>
          ) : Math.abs(netDiff) <= 1 && Math.abs(taxDiff) <= 1 && Math.abs(netDiff + taxDiff) <= 1 ? (
            <Chip tone="warn" icon="i-alert">One cent off · record the rounding adjustment</Chip>
          ) : (
            <Chip tone="bad" icon="i-x">Unbalanced by {formatMoney(money(netDiff + taxDiff), { showCents: true })}</Chip>
          )}
        </Row>
      </Row>
      {invalid ? <Sub style={{ color: 'var(--bad)' }}>{invalid}</Sub> : null}
    </div>
  );
}
