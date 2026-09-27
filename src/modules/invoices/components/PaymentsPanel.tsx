'use client';

import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextAreaField, TextField } from '@/shared/components/Field';
import { Grid, Stack, Sub } from '@/shared/components/Layout';
import { formatMoney, type Money } from '@/shared/lib/money';
import { formatDateLong } from '@/shared/lib/dates';
import type { InvoicesWorkspace, PaymentRow, ReconciliationRow } from '../api';
import type { PaymentImportRow } from '../model';
import {
  allocateSettlementAction,
  confirmImportAction,
  dryRunImportAction,
  excludeItemAction,
  matchItemAction,
  recordPaymentAction,
  releaseRetentionAction,
  reversePaymentAction,
} from '../actions';

const fmt = (value: Money): string => formatMoney(value, { showCents: true });

/** INV13–INV15, INT07, AT23, CST07 — payment evidence, settlement, the reconciliation queue and imports. */
export function PaymentsPanel({ workspace }: { readonly workspace: InvoicesWorkspace }) {
  const { permissions } = workspace;
  const openItems = workspace.reconciliation.filter((item) => item.state === 'open');
  const openPayments = workspace.payments.filter((payment) => payment.unapplied.cents > 0);
  const invoiceOptions = [{ value: '', label: 'Choose an approved invoice…' }, ...workspace.approvedInvoiceOptions.map((option) => ({ value: option.id, label: option.label }))];

  return (
    <Stack>
      {!permissions.canPay ? (
        <Banner tone="info" icon="i-shield" title="Read only">Recording payments, settlements, imports and reconciliation needs payment authority on this project.</Banner>
      ) : null}
      <Banner tone="info" icon="i-link" title="No accounting connection">
        Payments are evidence entered here or imported from a bank CSV. Approval never marks an invoice paid; periods on or before {formatDateLong(workspace.actualsCutoff)} are closed.
      </Banner>

      <Card>
        <CardHeader title="Payments" aside={<Sub>{workspace.payments.length} recorded · suspense {fmt(workspace.suspenseTotal)}</Sub>} />
        <DataTable
          columns={[
            {
              header: 'Payment',
              lead: true,
              render: (row: PaymentRow) => (
                <>
                  <CellMain>{row.reference}</CellMain>
                  <CellSub>
                    {row.origin === 'import' ? `Imported · ${row.sourceId ?? ''}` : 'Manual'}
                    {row.supplierName ? ` · ${row.supplierName}` : ''}
                    {row.reversesReference ? ` · reverses ${row.reversesReference}` : ''}
                  </CellSub>
                </>
              ),
            },
            { header: 'Effective', render: (row: PaymentRow) => `${formatDateLong(row.date)}${row.locked ? ' · closed period' : ''}` },
            { header: 'Direction', render: (row: PaymentRow) => (row.direction === 'outflow' ? 'Paid out' : 'Received') },
            {
              header: 'Status',
              render: (row: PaymentRow) =>
                row.reversed ? (
                  <Chip tone="neutral" icon="i-x">Reversed</Chip>
                ) : row.unapplied.cents > 0 ? (
                  <Chip tone="warn" icon="i-alert">Unallocated {fmt(row.unapplied)}</Chip>
                ) : (
                  <Chip tone="good" icon="i-check">Allocated</Chip>
                ),
            },
            { header: 'Amount', align: 'right', render: (row: PaymentRow) => <span className="num">{row.direction === 'inflow' ? '+' : ''}{fmt(row.amount)}</span> },
          ]}
          rows={workspace.payments}
          rowKey={(row) => row.id}
          empty="No payments recorded."
        />
      </Card>

      {permissions.canPay ? (
        <Grid columns={2}>
          <Card>
            <CardHeader title="Record a payment" aside={<Sub>Must be dated after {formatDateLong(workspace.actualsCutoff)}</Sub>} />
            <CardBody>
              <ActionForm action={recordPaymentAction} submitLabel="Record payment" hiddenFields={{ projectId: workspace.projectId }}>
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <TextField id="pay-amount" name="amount" label="Amount (gross)" inputMode="decimal" required invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                    <SelectField id="pay-dir" name="direction" label="Direction" options={[{ value: 'outflow', label: 'Paid out' }, { value: 'inflow', label: 'Received (refund)' }]} />
                    <TextField id="pay-date" name="effectiveDate" label="Effective date" type="date" defaultValue={workspace.today} invalid={Boolean(firstError(fieldErrors, 'effectiveDate'))} hint={firstError(fieldErrors, 'effectiveDate')} />
                    <TextField id="pay-ref" name="reference" label="Reference" required invalid={Boolean(firstError(fieldErrors, 'reference'))} hint={firstError(fieldErrors, 'reference')} />
                    <SelectField id="pay-sup" name="supplierId" label="Supplier" options={[{ value: '', label: 'Not specified' }, ...workspace.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
                    <TextField id="pay-src" name="sourceId" label="Bank source id (optional)" />
                    <SelectField id="pay-inv" name="allocInvoiceId" label="Allocate to (optional)" options={invoiceOptions} />
                    <TextField id="pay-alloc" name="allocAmount" label="Allocation amount" inputMode="decimal" />
                    <SelectField id="pay-type" name="allocType" label="Allocation type" options={[{ value: 'cash', label: 'Cash' }, { value: 'refund', label: 'Refund (received)' }, { value: 'retention-release', label: 'Retention release' }]} />
                    <TextField id="pay-note" name="note" label="Note" />
                  </FieldGrid>
                )}
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Allocate a settlement" aside={<Sub>Cash, credit note or non-cash</Sub>} />
            <CardBody>
              <ActionForm action={allocateSettlementAction} submitLabel="Allocate">
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField id="set-inv" name="invoiceId" label="Invoice" options={invoiceOptions} />
                    <SelectField
                      id="set-src"
                      name="source"
                      label="Source"
                      options={[
                        { value: '', label: 'No source (withholding / other non-cash)' },
                        ...openPayments.map((payment) => ({ value: `payment:${payment.id}`, label: `Payment ${payment.reference} · ${fmt(payment.unapplied)} unallocated` })),
                        ...workspace.creditNoteOptions.map((credit) => ({ value: `credit:${credit.id}`, label: `Credit ${credit.label} · ${fmt(credit.unapplied)} unapplied` })),
                      ]}
                    />
                    <SelectField
                      id="set-type"
                      name="settlementType"
                      label="Settlement type"
                      options={[
                        { value: 'cash', label: 'Cash' },
                        { value: 'credit', label: 'Credit note applied' },
                        { value: 'withholding', label: 'Withholding' },
                        { value: 'refund', label: 'Refund' },
                        { value: 'other-noncash', label: 'Other non-cash' },
                      ]}
                    />
                    <TextField id="set-amt" name="amount" label="Amount (gross)" inputMode="decimal" invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                  </FieldGrid>
                )}
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Reverse a payment" aside={<Sub>A controlled adjustment; the original is never rewritten (AT23)</Sub>} />
            <CardBody>
              <ActionForm action={reversePaymentAction} submitLabel="Record reversal" submitVariant="default">
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField
                      id="rev-pay"
                      name="paymentId"
                      label="Payment"
                      options={[{ value: '', label: 'Choose a payment…' }, ...workspace.payments.filter((row) => !row.reversed && !row.reversesReference).map((row) => ({ value: row.id, label: `${row.reference} · ${fmt(row.amount)} · ${row.date}` }))]}
                    />
                    <TextField id="rev-date" name="effectiveDate" label="Reversal date (open period)" type="date" defaultValue={workspace.today} />
                    <TextField id="rev-reason" name="reason" label="Reason" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                  </FieldGrid>
                )}
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Release retention" aside={<Sub>Paid from a recorded payment (CST07)</Sub>} />
            <CardBody>
              {workspace.retention.some((row) => !row.released) ? (
                <ActionForm action={releaseRetentionAction} submitLabel="Release" submitVariant="default">
                  {() => (
                    <FieldGrid>
                      <SelectField id="rr-tr" name="trancheId" label="Tranche" options={workspace.retention.filter((row) => !row.released).map((row) => ({ value: row.id, label: `${row.invoiceNumber} · ${fmt(row.amount)} · ${row.condition} · forecast ${row.forecast}` }))} />
                      <SelectField id="rr-pay" name="paymentId" label="Payment" options={[{ value: '', label: 'Choose a payment…' }, ...openPayments.filter((row) => row.direction === 'outflow').map((row) => ({ value: row.id, label: `${row.reference} · ${fmt(row.unapplied)} unallocated` }))]} />
                    </FieldGrid>
                  )}
                </ActionForm>
              ) : (
                <Sub>No retention is held.</Sub>
              )}
            </CardBody>
          </Card>
        </Grid>
      ) : null}

      <Card>
        <CardHeader title="Reconciliation queue" aside={<Sub>{openItems.length} open · match, split or exclude with a reason (INV15)</Sub>} />
        <DataTable
          columns={[
            {
              header: 'Item',
              lead: true,
              render: (row: ReconciliationRow) => (
                <>
                  <CellMain>{row.reference}</CellMain>
                  <CellSub>{row.kind === 'unmatched-payment' ? 'Unmatched payment' : 'External bill'}{row.reason ? ` · ${row.reason}` : ''}</CellSub>
                </>
              ),
            },
            { header: 'Effective', render: (row: ReconciliationRow) => formatDateLong(row.date) },
            {
              header: 'State',
              render: (row: ReconciliationRow) =>
                row.state === 'open' ? <Chip tone="warn" icon="i-alert">Open</Chip> : row.state === 'matched' ? <Chip tone="good" icon="i-check">Matched</Chip> : <Chip tone="neutral" icon="i-x">Excluded</Chip>,
            },
            { header: 'Outstanding', align: 'right', render: (row: ReconciliationRow) => <span className="num">{fmt(row.outstanding)}</span> },
            { header: 'Amount', align: 'right', render: (row: ReconciliationRow) => <span className="num">{fmt(row.amount)}</span> },
          ]}
          rows={workspace.reconciliation}
          rowKey={(row) => row.id}
          empty="Nothing waiting to be reconciled."
        />
        {permissions.canPay && openItems.length > 0 ? (
          <CardBody>
            <Grid columns={2}>
              <ActionForm action={matchItemAction} submitLabel="Match">
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField id="m-item" name="itemId" label="Open item" options={openItems.map((item) => ({ value: item.id, label: `${item.reference} · ${fmt(item.outstanding)}` }))} />
                    <SelectField id="m-inv" name="invoiceId" label="Invoice" options={invoiceOptions} />
                    <TextField id="m-amt" name="amount" label="Amount (less than outstanding to split)" inputMode="decimal" invalid={Boolean(firstError(fieldErrors, 'amount'))} hint={firstError(fieldErrors, 'amount')} />
                  </FieldGrid>
                )}
              </ActionForm>
              <ActionForm action={excludeItemAction} submitLabel="Exclude" submitVariant="default">
                {({ fieldErrors }) => (
                  <FieldGrid>
                    <SelectField id="x-item" name="itemId" label="Open item" options={openItems.map((item) => ({ value: item.id, label: `${item.reference} · ${fmt(item.outstanding)}` }))} />
                    <TextField id="x-reason" name="reason" label="Reason" invalid={Boolean(firstError(fieldErrors, 'reason'))} hint={firstError(fieldErrors, 'reason')} />
                  </FieldGrid>
                )}
              </ActionForm>
            </Grid>
          </CardBody>
        ) : null}
      </Card>

      {permissions.canPay ? (
        <Card>
          <CardHeader title="Import payments from CSV" aside={<Sub>Dry run first · confirm to create · confirming twice creates nothing more (INT07)</Sub>} />
          <CardBody className="stack">
            <ActionForm action={dryRunImportAction} submitLabel="Dry run" submitVariant="default" hiddenFields={{ projectId: workspace.projectId }}>
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextAreaField
                    id="imp-csv"
                    name="csvText"
                    label="CSV text · Date, Amount, Reference, SourceId, Supplier (optional), Currency (optional)"
                    rows={5}
                    placeholder={'Date,Amount,Reference,SourceId,Supplier\n2026-09-10,-242000.00,INV-1003,XR-8120,Brisbane Civil & Build Pty Ltd'}
                    invalid={Boolean(firstError(fieldErrors, 'csvText'))}
                    hint={firstError(fieldErrors, 'csvText')}
                  />
                  <div className="field">
                    <label htmlFor="imp-file">…or upload a .csv</label>
                    <input id="imp-file" name="csvFile" type="file" accept=".csv,text/csv" />
                  </div>
                </FieldGrid>
              )}
            </ActionForm>
            {workspace.pendingImports.map((record) => (
              <Card key={record.id}>
                <CardHeader
                  title={`Dry run · ${record.filename ?? 'pasted CSV'}`}
                  aside={<Sub>{record.totals.rows} rows · {record.totals.new} new ({fmt(record.totals.amount)}) · {record.totals.duplicates} duplicate · {record.totals.invalid} invalid</Sub>}
                />
                <DataTable
                  columns={[
                    { header: 'Line', lead: true, render: (row: PaymentImportRow) => <CellMain>{row.line} · {row.sourceId || '—'}</CellMain> },
                    { header: 'Date', render: (row: PaymentImportRow) => row.effectiveDate || '—' },
                    { header: 'Reference', render: (row: PaymentImportRow) => `${row.reference}${row.supplierName ? ` · ${row.supplierName}` : ''}` },
                    {
                      header: 'Status',
                      render: (row: PaymentImportRow) =>
                        row.status === 'new' ? <Chip tone="good" icon="i-check">New</Chip> : row.status === 'duplicate' ? <Chip tone="warn" icon="i-alert">Duplicate · {row.problem}</Chip> : <Chip tone="bad" icon="i-x">Invalid · {row.problem}</Chip>,
                    },
                    { header: 'Amount', align: 'right', render: (row: PaymentImportRow) => <span className="num">{fmt(row.amount)}</span> },
                  ]}
                  rows={record.rows}
                  rowKey={(row) => String(row.line)}
                />
                <CardBody>
                  <ActionForm action={confirmImportAction} submitLabel={`Confirm ${record.totals.new} new payment${record.totals.new === 1 ? '' : 's'}`} render="inline" submitVariant="primary" hiddenFields={{ projectId: workspace.projectId, importId: record.id }} />
                </CardBody>
              </Card>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </Stack>
  );
}
