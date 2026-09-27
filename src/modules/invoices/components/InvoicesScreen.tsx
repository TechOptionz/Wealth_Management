'use client';

import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Banner } from '@/shared/components/Banner';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { FilterGroup } from '@/shared/components/FilterGroup';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { Tabs } from '@/shared/components/Tabs';
import { formatMoney, money, type Money } from '@/shared/lib/money';
import { formatDateLong, formatDateShort } from '@/shared/lib/dates';
import type { InvoiceRow, InvoicesWorkspace } from '../api';
import { REVIEW_STATE_LABELS, REVIEW_STATES, type ReviewState } from '../model';
import { captureInvoiceAction } from '../actions';
import { AllocationsEditor, toCents } from './AllocationsEditor';
import { ReviewStateChip, SettlementChip, SyncChip } from './chips';
import { InvoiceReview } from './InvoiceReview';
import { PaymentsPanel } from './PaymentsPanel';
import { CommitmentsPanel } from './CommitmentsPanel';

type Tab = 'register' | 'review' | 'payments' | 'commitments';
type Filter = ReviewState | 'all';

const fmt = (value: Money): string => formatMoney(value, { showCents: true });

/** §8 — the invoices workspace: register, review, payments & reconciliation, commitments. */
export function InvoicesScreen({ workspace, initialInvoiceId }: { readonly workspace: InvoicesWorkspace; readonly initialInvoiceId: string | null }) {
  const firstId = initialInvoiceId && workspace.details[initialInvoiceId] ? initialInvoiceId : null;
  const [tab, setTab] = useState<Tab>(firstId ? 'review' : 'register');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(firstId ?? workspace.invoices.find((row) => row.reviewState === 'awaiting-approval')?.id ?? workspace.invoices[0]?.id ?? null);
  const [capturing, setCapturing] = useState(false);

  const rows = filter === 'all' ? workspace.invoices : workspace.invoices.filter((row) => row.reviewState === filter);
  const selected = selectedId ? workspace.details[selectedId] : undefined;
  const awaiting = workspace.invoices.filter((row) => row.reviewState === 'awaiting-approval');
  const unpaid = workspace.invoices.filter((row) => row.reviewState === 'approved' && row.type === 'invoice');

  const columns: readonly DataTableColumn<InvoiceRow>[] = [
    {
      header: 'Supplier · number',
      lead: true,
      render: (row) => (
        <>
          <CellMain>{row.supplierName}</CellMain>
          <CellSub>{row.type === 'credit-note' ? 'Credit note ' : ''}{row.number}</CellSub>
        </>
      ),
    },
    { header: 'Dates', render: (row) => `${formatDateShort(row.invoiceDate)} · due ${formatDateShort(row.dueDate)}` },
    { header: 'Gross', align: 'right', render: (row) => <span className="num">{row.type === 'credit-note' ? '−' : ''}{fmt(row.gross)}</span> },
    { header: 'Review', render: (row) => <ReviewStateChip state={row.reviewState} /> },
    { header: 'Settlement', render: (row) => <SettlementChip state={row.settlementState} /> },
    { header: 'Sync', render: () => <SyncChip /> },
    {
      header: 'Checks',
      render: (row) =>
        row.unresolvedDuplicates > 0 ? (
          <Chip tone="bad" icon="i-alert">Possible duplicate</Chip>
        ) : row.duplicateCount > 0 ? (
          <Chip tone="neutral" icon="i-check">Duplicate resolved</Chip>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Stack>
      <KpiGrid>
        <Kpi label="Awaiting approval" value={String(awaiting.length)} valueSuffix={fmt(money(awaiting.reduce((sum, row) => sum + row.gross.cents, 0)))} accent />
        <Kpi label="Approved unpaid" value={fmt(money(unpaid.reduce((sum, row) => sum + Math.max(row.unpaid.cents, 0), 0)))} footer={<Sub>Including retention held</Sub>} />
        <Kpi label="Unmatched payments" value={fmt(workspace.suspenseTotal)} footer={<Sub>Held in suspense until matched</Sub>} />
        <Kpi label="Your approval limit" value={workspace.permissions.approvalLimit ? fmt(workspace.permissions.approvalLimit) : 'None'} footer={<Sub>{workspace.userName} · gross incl. GST</Sub>} />
      </KpiGrid>

      <Tabs
        tabs={[
          { value: 'register', label: `Register (${workspace.invoices.length})` },
          { value: 'review', label: selected ? `Review · ${selected.number}` : 'Review' },
          { value: 'payments', label: 'Payments & reconciliation' },
          { value: 'commitments', label: 'Commitments' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'register' ? (
        <Stack>
          {workspace.failedIntakes.length > 0 ? (
            <Banner tone="warn" title={`${workspace.failedIntakes.length} document${workspace.failedIntakes.length === 1 ? '' : 's'} failed intake checks`}>
              {workspace.failedIntakes.map((intake) => `${intake.filename} (${intake.reason})`).join(' · ')} · no invoice was created from {workspace.failedIntakes.length === 1 ? 'it' : 'them'}.
            </Banner>
          ) : null}
          <Toolbar>
            <FilterGroup
              label="Filter by review state"
              options={[{ value: 'all' as Filter, label: 'All', count: workspace.counts.all }, ...REVIEW_STATES.filter((state) => workspace.counts[state] > 0).map((state) => ({ value: state as Filter, label: REVIEW_STATE_LABELS[state], count: workspace.counts[state] }))]}
              value={filter}
              onChange={setFilter}
            />
            {workspace.permissions.canCapture ? (
              <Button variant="primary" onClick={() => setCapturing((open) => !open)} aria-expanded={capturing}>
                {capturing ? 'Close' : '+ Capture invoice'}
              </Button>
            ) : null}
          </Toolbar>
          {capturing ? <CaptureInvoiceForm workspace={workspace} onDone={() => setCapturing(false)} /> : null}
          <Card>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => {
                setSelectedId(row.id);
                setTab('review');
              }}
              isRowSelected={(row) => row.id === selectedId}
              empty="No invoices in this state."
            />
          </Card>
          <Sub style={{ fontSize: 12 }}>
            Review, sync and settlement are separate: approval is local and never synced (no accounting connection), and paid is derived from recorded settlements.
          </Sub>
        </Stack>
      ) : null}

      {tab === 'review' ? (
        selected ? (
          <InvoiceReview key={selected.id} detail={selected} workspace={workspace} />
        ) : (
          <Card>
            <CardBody>
              <Sub>Choose an invoice from the register to review it.</Sub>
            </CardBody>
          </Card>
        )
      ) : null}

      {tab === 'payments' ? <PaymentsPanel workspace={workspace} /> : null}
      {tab === 'commitments' ? <CommitmentsPanel workspace={workspace} /> : null}
    </Stack>
  );
}

/** INV01/INV05/INV07 — manual capture, optionally with the PDF/PNG/JPEG it came from. */
function CaptureInvoiceForm({ workspace, onDone }: { readonly workspace: InvoicesWorkspace; readonly onDone: () => void }) {
  const [net, setNet] = useState('');
  const [tax, setTax] = useState('');
  return (
    <Card>
      <CardHeader title="Capture an invoice" aside={<Sub>Automated extraction is deferred; enter the fields by hand</Sub>} />
      <CardBody>
        <ActionForm
          action={captureInvoiceAction}
          submitLabel="Capture · needs review"
          onCancel={onDone}
          onSuccess={onDone}
          hiddenFields={{ projectId: workspace.projectId }}
          footnote={
            <Sub style={{ fontSize: 12 }}>
              PDF, PNG or JPEG up to 20 MB. The content type is checked from the file itself and a sha256 is recorded; the file is not stored in this build. A
              file that fails its checks stays visible as a failed intake and creates no invoice.
            </Sub>
          }
        >
          {({ fieldErrors }) => (
            <FieldGrid>
              <div className="field">
                <label htmlFor="cap-doc">Document (optional)</label>
                <input id="cap-doc" name="document" type="file" accept="application/pdf,image/png,image/jpeg" />
              </div>
              <SelectField id="cap-type" name="type" label="Type" options={[{ value: 'invoice', label: 'Invoice' }, { value: 'credit-note', label: 'Credit note' }]} />
              <SelectField id="cap-sup" name="supplierId" label="Supplier" options={[{ value: '', label: 'Choose…' }, ...workspace.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} invalid={Boolean(firstError(fieldErrors, 'supplierId'))} hint={firstError(fieldErrors, 'supplierId')} />
              <TextField id="cap-num" name="number" label="Number" invalid={Boolean(firstError(fieldErrors, 'number'))} hint={firstError(fieldErrors, 'number')} />
              <TextField id="cap-date" name="invoiceDate" label="Invoice date" type="date" defaultValue={workspace.today} />
              <TextField id="cap-due" name="dueDate" label="Due date" type="date" />
              <TextField id="cap-net" name="net" label="Net (ex GST) · AUD" inputMode="decimal" value={net} onChange={(event) => setNet(event.target.value)} invalid={Boolean(firstError(fieldErrors, 'net'))} hint={firstError(fieldErrors, 'net')} />
              <TextField id="cap-tax" name="tax" label="GST" inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} hint={`Gross ${formatMoney(money(toCents(net) + toCents(tax)), { showCents: true })}`} />
              <TextField id="cap-round" name="roundingAdjustment" label="Rounding adjustment (max ±0.01)" inputMode="decimal" />
              <TextField id="cap-desc" name="lineDescription" label="Description" />
              <AllocationsEditor
                idPrefix="cap"
                initial={[]}
                costLines={workspace.costLines}
                commitments={workspace.commitmentOptions}
                invoiceNet={toCents(net)}
                invoiceTax={toCents(tax)}
                invalid={firstError(fieldErrors, 'allocations')}
              />
              <Sub style={{ gridColumn: '1 / -1' }}>Actuals are closed to {formatDateLong(workspace.actualsCutoff)}; an invoice dated on or before it needs finance review.</Sub>
            </FieldGrid>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}
