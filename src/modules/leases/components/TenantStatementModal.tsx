'use client';

import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import type { IconName } from '@/shared/components/IconSprite';
import { Kpi } from '@/shared/components/Kpi';
import { Grid, Stack, Stat, Sub } from '@/shared/components/Layout';
import { Modal } from '@/shared/components/Modal';
import { formatDateCompact, formatDateLong } from '@/shared/lib/dates';
import { formatMoney, type Money } from '@/shared/lib/money';
import type { Tone } from '@/shared/types/common';
import { LEDGER_ENTRY_LABELS, type LeaseLedger, type LeaseLedgerEntry, type LedgerEntryType } from '../model';

/** Every line type carries an icon and a word, so the statement still reads in greyscale (NFR-07). */
const ENTRY_CHIP: Record<LedgerEntryType, { readonly tone: Tone; readonly icon: IconName }> = {
  charge: { tone: 'neutral', icon: 'i-file' },
  receipt: { tone: 'good', icon: 'i-check' },
  credit: { tone: 'info', icon: 'i-wallet' },
  reversal: { tone: 'bad', icon: 'i-alert' },
};

/** Statements show cents — the design reserves whole dollars for KPI tiles on the dashboard. */
const cents = (value: Money): string => formatMoney(value, { showCents: true });

/** "$340.00 CR" for money held in credit; plain when owing. */
function formatBalance(value: Money): string {
  if (value.cents < 0) return `${cents({ cents: -value.cents, currency: value.currency })} CR`;
  return cents(value);
}

const columns: readonly DataTableColumn<LeaseLedgerEntry>[] = [
  { header: 'Date', lead: true, render: (row) => <span className="num">{formatDateLong(row.date)}</span> },
  {
    header: 'Item / description',
    mobileLabel: 'Item',
    render: (row) => {
      const chip = ENTRY_CHIP[row.type];
      return (
        <>
          <CellMain>{row.description}</CellMain>
          <CellSub>
            <Chip tone={chip.tone} icon={chip.icon}>
              {LEDGER_ENTRY_LABELS[row.type]}
            </Chip>
          </CellSub>
        </>
      );
    },
  },
  {
    header: 'Debit',
    align: 'right',
    render: (row) => <span className="num">{row.side === 'debit' ? cents(row.amount) : '—'}</span>,
  },
  {
    header: 'Credit',
    align: 'right',
    render: (row) => <span className="num">{row.side === 'credit' ? cents(row.amount) : '—'}</span>,
  },
  {
    header: 'Balance',
    align: 'right',
    render: (row) => (
      <span className="num" style={{ fontWeight: 500 }}>
        {formatBalance(row.balance)}
      </span>
    ),
  },
];

export interface TenantStatementModalProps {
  readonly ledger: LeaseLedger;
  readonly onClose: () => void;
}

/**
 * FR-05 / BR-05 — the formal statement of account for one lease.
 *
 * Presentation only: the ledger arrives fully derived from the service, so this
 * component never adds money up itself. "Print statement" hands the open dialog
 * to the browser; `modal.css` prints the dialog alone, on white.
 */
export function TenantStatementModal({ ledger, onClose }: TenantStatementModalProps) {
  const balanceCents = ledger.currentBalance.cents;
  const chargeCount = ledger.entries.filter((entry) => entry.type === 'charge').length;
  const paymentCount = ledger.entries.length - chargeCount;

  const balanceState =
    balanceCents < 0
      ? { suffix: 'in credit', tone: 'good' as const, icon: 'i-check' as const, label: 'Paid ahead' }
      : balanceCents === 0
        ? { suffix: 'settled', tone: 'good' as const, icon: 'i-check' as const, label: 'Nothing owing' }
        : { suffix: 'owing', tone: 'bad' as const, icon: 'i-alert' as const, label: 'In arrears' };

  return (
    <Modal
      wide
      title="Statement of account"
      subtitle={`${ledger.tenantName} · ${ledger.reference} · as at ${formatDateLong(ledger.asOf)}`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => window.print()}>
            Print statement
          </Button>
        </>
      }
    >
      <Stack>
        <div className="statement-meta">
          <Stat label="Tenant" value={ledger.tenantName} />
          <Stat label="Property · component" value={ledger.propertyLabel} />
          <Stat label="Reference" value={ledger.reference} />
          <Stat
            label="Statement date"
            value={formatDateLong(ledger.asOf)}
            meta={`Lease ${formatDateCompact(ledger.leasePeriod.startsOn)} – ${formatDateCompact(ledger.leasePeriod.endsOn)}`}
          />
        </div>

        <Grid columns={3}>
          <Kpi
            label="Total invoiced"
            value={cents(ledger.totalCharged)}
            footer={`${chargeCount} charge${chargeCount === 1 ? '' : 's'} fallen due`}
          />
          <Kpi
            label="Total paid"
            value={cents(ledger.totalReceived)}
            footer={`${paymentCount} ${paymentCount === 1 ? 'entry' : 'entries'} · receipts and credits, less reversals`}
          />
          <Kpi
            accent
            label="Outstanding balance"
            value={cents({ cents: Math.abs(balanceCents), currency: ledger.currentBalance.currency })}
            valueSuffix={balanceState.suffix}
            footer={
              <Chip tone={balanceState.tone} icon={balanceState.icon}>
                {balanceState.label}
              </Chip>
            }
          />
        </Grid>

        <Card>
          <DataTable
            columns={columns}
            rows={ledger.entries}
            rowKey={(row) => row.id}
            empty="No charges had fallen due and no payments had been received by this date."
          />
        </Card>

        <Sub style={{ fontSize: 12 }}>
          Charges appear once they fall due; rent not yet due is not shown. Payments settle the oldest unpaid charge
          first. A balance marked CR is money held in credit against future rent.
        </Sub>
      </Stack>
    </Modal>
  );
}
