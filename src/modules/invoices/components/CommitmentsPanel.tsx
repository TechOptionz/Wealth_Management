'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Row, Stack, Sub } from '@/shared/components/Layout';
import { formatMoney, money, type Money } from '@/shared/lib/money';
import { TAX_TREATMENT_LABELS } from '@/shared/finance-engine';
import {
  authoriseCommitmentAction,
  createCommitmentAction,
  createSupplierAction,
  decideVariationAction,
  submitVariationAction,
} from '@/modules/commitments/actions';
import type { CommitmentRow, InvoicesWorkspace } from '../api';
import { toCents } from './AllocationsEditor';

const fmt = (value: Money): string => formatMoney(value, { showCents: false });

type VariationRow = CommitmentRow['variations'][number] & { readonly commitmentReference: string };

/** CST03–CST05 — suppliers, contracts and their positions on one gross basis, and variations with the pending risk kept apart. */
export function CommitmentsPanel({ workspace }: { readonly workspace: InvoicesWorkspace }) {
  const canEdit = workspace.permissions.canEditBudget;
  const [creating, setCreating] = useState(false);
  const variations: VariationRow[] = workspace.commitments.flatMap((commitment) => commitment.variations.map((variation) => ({ ...variation, commitmentReference: commitment.reference })));

  return (
    <Stack>
      <Banner tone="info" icon="i-calc" title={`Pending variation risk ${fmt(workspace.pendingVariationRisk)} (ex GST)`}>
        Submitted variations are risk, not obligation: they change a contract only once approved by someone other than the submitter (CST04).
      </Banner>

      <Card>
        <CardHeader title="Commitments" aside={canEdit ? <Button small variant="primary" onClick={() => setCreating((open) => !open)}>{creating ? 'Close' : '+ New commitment'}</Button> : <Sub>Position shown gross, including GST (CST05)</Sub>} />
        {creating ? <NewCommitmentForm workspace={workspace} onDone={() => setCreating(false)} /> : null}
        <DataTable
          columns={[
            {
              header: 'Contract',
              lead: true,
              render: (row: CommitmentRow) => (
                <>
                  <CellMain>{row.reference} · {row.title}</CellMain>
                  <CellSub>{row.supplierName} · net {fmt(row.original)} → revised {fmt(row.revised)}{row.pending.cents ? ` · pending ${fmt(row.pending)}` : ''}</CellSub>
                </>
              ),
            },
            {
              header: 'State',
              render: (row: CommitmentRow) =>
                row.state === 'draft' && canEdit ? (
                  <Row>
                    <Chip tone="neutral" icon="i-clock">Draft</Chip>
                    <ActionForm action={authoriseCommitmentAction} submitLabel="Authorise" render="inline" hiddenFields={{ commitmentId: row.id }} />
                  </Row>
                ) : (
                  <Chip tone={row.state === 'authorised' ? 'good' : 'neutral'} icon={row.state === 'authorised' ? 'i-check' : 'i-clock'}>{row.stateLabel}</Chip>
                ),
            },
            { header: 'Contract total', align: 'right', render: (row: CommitmentRow) => <span className="num">{fmt(row.position.contractTotal)}</span> },
            { header: 'Invoiced', align: 'right', render: (row: CommitmentRow) => <span className="num">{fmt(row.position.invoicedToDate)}</span> },
            { header: 'Paid', align: 'right', render: (row: CommitmentRow) => <span className="num">{fmt(row.position.paidToDate)}</span> },
            { header: 'Approved unpaid', align: 'right', render: (row: CommitmentRow) => <span className="num">{fmt(row.position.approvedUnpaid)}</span> },
            { header: 'Uninvoiced', align: 'right', render: (row: CommitmentRow) => <span className="num">{fmt(row.position.uninvoicedBalance)}</span> },
            { header: 'Remaining estimate', align: 'right', render: (row: CommitmentRow) => <span className="num">{fmt(row.position.remainingEstimate)}</span> },
          ]}
          rows={workspace.commitments}
          rowKey={(row) => row.id}
          empty="No commitments recorded."
        />
      </Card>

      <Card>
        <CardHeader title="Variations" aside={<Sub>Only approved variations change the contract value</Sub>} />
        <DataTable
          columns={[
            {
              header: 'Variation',
              lead: true,
              render: (row: VariationRow) => (
                <>
                  <CellMain>{row.commitmentReference} {row.reference} · {row.description}</CellMain>
                  <CellSub>Submitted by {row.submittedByName ?? '—'}{row.decidedByName ? ` · decided by ${row.decidedByName}` : ''}{row.reason ? ` · ${row.reason}` : ''}</CellSub>
                </>
              ),
            },
            {
              header: 'State',
              render: (row: VariationRow) => (
                <Chip tone={row.state === 'approved' ? 'good' : row.state === 'rejected' ? 'bad' : 'gold'} icon={row.state === 'approved' ? 'i-check' : row.state === 'rejected' ? 'i-x' : 'i-clock'}>
                  {row.stateLabel}
                </Chip>
              ),
            },
            { header: 'Net', align: 'right', render: (row: VariationRow) => <span className="num">{formatMoney(row.amount, { signed: true })}</span> },
            {
              header: 'Decision',
              render: (row: VariationRow) =>
                row.state !== 'submitted' || !canEdit ? (
                  '—'
                ) : row.isOwnSubmission ? (
                  <Sub>You submitted this; another person must decide it.</Sub>
                ) : (
                  <Row>
                    <ActionForm action={decideVariationAction} submitLabel="Approve" render="inline" submitVariant="primary" hiddenFields={{ variationId: row.id, decision: 'approved' }} />
                    <ActionForm action={decideVariationAction} submitLabel="Reject" render="inline" hiddenFields={{ variationId: row.id, decision: 'rejected', reason: 'Rejected at review' }} />
                  </Row>
                ),
            },
          ]}
          rows={variations}
          rowKey={(row) => row.id}
          empty="No variations."
        />
        {canEdit ? (
          <CardBody>
            <ActionForm action={submitVariationAction} submitLabel="Submit variation" submitVariant="default">
              {({ fieldErrors }) => (
                <FieldGrid>
                  <SelectField id="var-c" name="commitmentId" label="Commitment" options={workspace.commitments.filter((row) => row.state === 'authorised').map((row) => ({ value: row.id, label: `${row.reference} · ${row.supplierName}` }))} />
                  <TextField id="var-ref" name="reference" label="Reference" placeholder="V-003" invalid={Boolean(firstError(fieldErrors, 'reference'))} hint={firstError(fieldErrors, 'reference')} />
                  <TextField id="var-desc" name="description" label="Description" invalid={Boolean(firstError(fieldErrors, 'description'))} hint={firstError(fieldErrors, 'description')} />
                  <TextField id="var-amt" name="amount" label="Amount ex GST (negative reduces)" inputMode="decimal" invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Suppliers" />
        <DataTable
          columns={[
            { header: 'Supplier', lead: true, render: (row: InvoicesWorkspace['suppliers'][number]) => <CellMain>{row.name}</CellMain> },
            { header: 'ABN', render: (row: InvoicesWorkspace['suppliers'][number]) => row.abn ?? '—' },
            {
              header: 'Bank details',
              render: (row: InvoicesWorkspace['suppliers'][number]) =>
                row.bankDetailsVerified ? <Chip tone="good" icon="i-check">Verified</Chip> : <Chip tone="warn" icon="i-alert">Not verified</Chip>,
            },
          ]}
          rows={workspace.suppliers}
          rowKey={(row) => row.id}
        />
        {canEdit ? (
          <CardBody>
            <ActionForm action={createSupplierAction} submitLabel="Add supplier" submitVariant="default" hiddenFields={{ projectId: workspace.projectId }}>
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField id="sup-name" name="name" label="Name" invalid={Boolean(firstError(fieldErrors, 'name'))} hint={firstError(fieldErrors, 'name')} />
                  <TextField id="sup-abn" name="abn" label="ABN" />
                  <TextField id="sup-contact" name="contactReference" label="Contact reference" />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        ) : null}
      </Card>
    </Stack>
  );
}

interface LineDraft {
  readonly costLineId: string;
  readonly amount: string;
}

/** CST03 — a new contract; the allocation running total must reach the contract value exactly. */
function NewCommitmentForm({ workspace, onDone }: { readonly workspace: InvoicesWorkspace; readonly onDone: () => void }) {
  const [total, setTotal] = useState('');
  const [lines, setLines] = useState<readonly LineDraft[]>([{ costLineId: '', amount: '' }]);
  const allocated = lines.reduce((sum, line) => sum + toCents(line.amount), 0);
  const difference = toCents(total) - allocated;

  return (
    <CardBody>
      <ActionForm action={createCommitmentAction} submitLabel="Record commitment (draft)" onCancel={onDone} onSuccess={onDone} hiddenFields={{ projectId: workspace.projectId, revision: String(workspace.modelRevision) }}>
        {({ fieldErrors }) => (
          <FieldGrid>
            <SelectField id="nc-sup" name="supplierId" label="Supplier" options={[{ value: '', label: 'Choose…' }, ...workspace.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} invalid={Boolean(firstError(fieldErrors, 'supplierId'))} hint={firstError(fieldErrors, 'supplierId')} />
            <TextField id="nc-ref" name="reference" label="Contract reference" placeholder="C-003" invalid={Boolean(firstError(fieldErrors, 'reference'))} hint={firstError(fieldErrors, 'reference')} />
            <TextField id="nc-title" name="title" label="Title" invalid={Boolean(firstError(fieldErrors, 'title'))} hint={firstError(fieldErrors, 'title')} />
            <TextField id="nc-amt" name="originalAmount" label="Contract value ex GST" inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} invalid={Boolean(firstError(fieldErrors, 'originalAmount'))} hint={firstError(fieldErrors, 'originalAmount')} />
            <SelectField id="nc-tax" name="taxTreatment" label="Tax basis" options={(['standard-gst', 'gst-free', 'input-taxed', 'out-of-scope'] as const).map((value) => ({ value, label: TAX_TREATMENT_LABELS[value] }))} />
            <TextField id="nc-start" name="startDate" label="Start date" type="date" defaultValue={workspace.today} />
            <TextField id="nc-end" name="endDate" label="End date" type="date" />
            <TextField id="nc-att" name="attachmentName" label="Signed contract file name" hint="Only the name is kept; files are not stored in this build" />
            {lines.map((line, index) => (
              <Row key={index} style={{ gridColumn: '1 / -1' }}>
                <div className="field" style={{ flex: 2 }}>
                  <label htmlFor={`nc-line-${index}`}>Cost line {index + 1}</label>
                  <select id={`nc-line-${index}`} name="allocCostLineId" value={line.costLineId} onChange={(event) => setLines((current) => current.map((row, position) => (position === index ? { ...row, costLineId: event.target.value } : row)))}>
                    <option value="">Choose a posting line…</option>
                    {workspace.costLines.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor={`nc-lamt-${index}`}>Amount ex GST</label>
                  <input id={`nc-lamt-${index}`} name="allocAmount" inputMode="decimal" value={line.amount} onChange={(event) => setLines((current) => current.map((row, position) => (position === index ? { ...row, amount: event.target.value } : row)))} />
                </div>
              </Row>
            ))}
            <Row style={{ gridColumn: '1 / -1', justifyContent: 'space-between' }}>
              <Button small onClick={() => setLines((current) => [...current, { costLineId: '', amount: '' }])}>+ Add cost line</Button>
              <Row>
                <Sub>Allocated {formatMoney(money(allocated), { showCents: true })} of {formatMoney(money(toCents(total)), { showCents: true })}</Sub>
                {difference === 0 && allocated > 0 ? <Chip tone="good" icon="i-check">Balanced</Chip> : <Chip tone="warn" icon="i-alert">{formatMoney(money(difference), { showCents: true, signed: true })} to allocate</Chip>}
              </Row>
            </Row>
            {firstError(fieldErrors, 'allocations') ? <Sub style={{ color: 'var(--bad)', gridColumn: '1 / -1' }}>{firstError(fieldErrors, 'allocations')}</Sub> : null}
          </FieldGrid>
        )}
      </ActionForm>
    </CardBody>
  );
}
