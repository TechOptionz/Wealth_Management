'use client';

import { useScrollToSelectedRow } from '@/shared/components/useScrollToSelectedRow';
import { useState } from 'react';
import { ActionForm, firstError } from '@/shared/components/ActionForm';
import { Button } from '@/shared/components/Button';
import { Card, CardBody, CardHeader } from '@/shared/components/Card';
import { Chip } from '@/shared/components/Chip';
import { DataTable, CellMain, CellSub, type DataTableColumn } from '@/shared/components/DataTable';
import { Kpi, KpiGrid } from '@/shared/components/Kpi';
import { FieldGrid, SelectField, TextField } from '@/shared/components/Field';
import { Row, Stack, Sub, Toolbar } from '@/shared/components/Layout';
import { formatMoney, formatPercent } from '@/shared/lib/money';
import { formatDateCompact, formatDateShort } from '@/shared/lib/dates';
import type { Available } from '@/shared/lib/result';
import type { Money } from '@/shared/lib/money';
import { createLoanAction } from '../actions';
import { RATIO_UNAVAILABLE_LABELS, type Loan, type RatioUnavailableReason } from '../model';

export interface LoanRow {
  readonly loan: Loan;
  readonly lvr: Available<number>;
  readonly lvrReason: RatioUnavailableReason | null;
}

export interface LoansScreenProps {
  readonly rows: readonly LoanRow[];
  readonly totalDebt: Money;
  readonly facilityCount: number;
  readonly portfolioLvr: Available<number>;
  readonly collateralRangeLabel: string | null;
  readonly repayments: { readonly total: Money; readonly principal: Money; readonly interest: Money };
  readonly nextReview: { readonly on: string; readonly detail: string } | null;
  readonly properties: readonly { readonly id: string; readonly name: string }[];
  readonly entities: readonly { readonly id: string; readonly name: string }[];
  readonly today: string;
  /** A facility to highlight on arrival, e.g. from a global search result. */
  readonly focusLoanId?: string;
}

/** Renders an LVR cell, or the reason it cannot be produced (BR-04). */
function LvrCell({ row }: { readonly row: LoanRow }) {
  if (row.lvr.available) return <span className="num">{formatPercent(row.lvr.value)}</span>;
  if (row.lvrReason === 'not-secured') return <>—</>;
  const label = row.lvrReason ? RATIO_UNAVAILABLE_LABELS[row.lvrReason] : 'Unavailable';
  return row.lvrReason === 'pool-without-policy' ? (
    <Chip tone="warn" icon="i-alert">
      {label}
    </Chip>
  ) : (
    <Chip tone="neutral">{label}</Chip>
  );
}

const columns: readonly DataTableColumn<LoanRow>[] = [
  {
    header: 'Lender · facility',
    mobileLabel: 'Facility',
    lead: true,
    render: ({ loan }) => (
      <>
        <CellMain>
          {loan.direction === 'receivable' ? loan.facilityName : `${loan.lender} · ${loan.facilityName}`}
        </CellMain>
        {loan.facilityNote ? <CellSub>{loan.facilityNote}</CellSub> : null}
      </>
    ),
  },
  { header: 'Borrower', render: ({ loan }) => loan.counterpartyLabel },
  {
    header: 'Balance',
    align: 'right',
    render: ({ loan }) => (
      <span className="num" style={loan.direction === 'receivable' ? { color: 'var(--good)' } : undefined}>
        {loan.direction === 'receivable' ? `+${formatMoney(loan.balance)}` : formatMoney(loan.balance)}
      </span>
    ),
  },
  { header: 'As of', render: ({ loan }) => formatDateCompact(loan.balanceAsOf) },
  {
    header: 'Rate',
    align: 'right',
    render: ({ loan }) => (
      <span className="num">
        {(loan.rate.annual * 100).toFixed(2)}%{loan.rate.type === 'fixed' ? ' fixed' : ' var'}
      </span>
    ),
  },
  {
    header: 'Repayment',
    render: ({ loan }) =>
      `${loan.repayment.type === 'custom' ? '' : `${loan.repayment.type} · `}${formatMoney(
        loan.repayment.monthly,
      )}/m`,
  },
  { header: 'Secured by', render: ({ loan }) => loan.security.label },
  { header: 'Property LVR', mobileLabel: 'LVR', align: 'right', render: (row) => <LvrCell row={row} /> },
];

/** FR-03, BR-04, FR-11 — facilities and liability ratios. */
export function LoansScreen({
  rows,
  totalDebt,
  facilityCount,
  portfolioLvr,
  collateralRangeLabel,
  repayments,
  nextReview,
  properties,
  entities,
  today,
  focusLoanId,
}: LoansScreenProps) {
  const [isCreating, setCreating] = useState(false);
  useScrollToSelectedRow(focusLoanId);

  return (
    <Stack>
      <Toolbar>
        <Sub>Liabilities and receivables, each counted once</Sub>
        <Row>
          <a className="btn sm" href="/api/export/loans" download>
            Export CSV
          </a>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Add facility
          </Button>
        </Row>
      </Toolbar>

      {isCreating ? (
        <Card>
          <CardHeader title="Add facility / loan" aside={<Sub>Figures as shown on the lender&apos;s statement</Sub>} />
          <CardBody>
            <ActionForm
              action={createLoanAction}
              submitLabel="Add facility"
              onCancel={() => setCreating(false)}
              onSuccess={() => setCreating(false)}
              footnote={
                <Sub style={{ fontSize: 12 }}>
                  A receivable is money owed to the portfolio: it is never added to debt or to an LVR (FR-11). The
                  principal and interest split is a working figure until a statement is recorded.
                </Sub>
              }
            >
              {({ fieldErrors }) => (
                <FieldGrid>
                  <TextField id="loan-lender" name="lender" label="Lender" required placeholder="Commonwealth Bank" />
                  <TextField
                    id="loan-facility" name="facilityName" label="Facility name" required
                    placeholder="Residential Variable Mortgage"
                  />
                  <SelectField
                    id="loan-direction" name="direction" label="Direction" defaultValue="liability"
                    options={[
                      { value: 'liability', label: 'Liability · money owed' },
                      { value: 'receivable', label: 'Receivable · money lent out' },
                    ]}
                  />
                  <TextField
                    id="loan-counterparty" name="counterpartyLabel" label="Borrower" required
                    placeholder="Holdfast Family Trust"
                  />
                  <SelectField
                    id="loan-entity" name="borrowerEntityId" label="Borrowing entity"
                    options={[{ value: '', label: 'Not linked' }, ...entities.map((e) => ({ value: e.id, label: e.name }))]}
                  />
                  <TextField
                    id="loan-balance" name="balance" label="Balance" required inputMode="decimal" placeholder="$450,000"
                    invalid={Boolean(firstError(fieldErrors, 'balance'))}
                    hint={firstError(fieldErrors, 'balance')}
                  />
                  <TextField
                    id="loan-asof" name="balanceAsOf" label="Balance as of" type="date" required defaultValue={today}
                    invalid={Boolean(firstError(fieldErrors, 'balanceAsOf'))}
                    hint={firstError(fieldErrors, 'balanceAsOf')}
                  />
                  <TextField
                    id="loan-rate" name="annualRate" label="Annual rate (%)" required inputMode="decimal" placeholder="5.85"
                    invalid={Boolean(firstError(fieldErrors, 'annualRate'))}
                    hint={firstError(fieldErrors, 'annualRate')}
                  />
                  <SelectField
                    id="loan-rate-type" name="rateType" label="Rate type" defaultValue="variable"
                    options={[
                      { value: 'variable', label: 'Variable' },
                      { value: 'fixed', label: 'Fixed' },
                    ]}
                  />
                  <SelectField
                    id="loan-repayment-type" name="repaymentType" label="Repayment type" defaultValue="P&I"
                    options={[
                      { value: 'P&I', label: 'Principal & interest' },
                      { value: 'IO', label: 'Interest only' },
                      { value: 'custom', label: 'Custom' },
                    ]}
                  />
                  <TextField
                    id="loan-monthly" name="monthlyRepayment" label="Monthly repayment" inputMode="decimal"
                    placeholder="$2,650"
                    invalid={Boolean(firstError(fieldErrors, 'monthlyRepayment'))}
                    hint={firstError(fieldErrors, 'monthlyRepayment')}
                  />
                  <SelectField
                    id="loan-security" name="securityPropertyId" label="Secured by"
                    options={[{ value: '', label: 'Unsecured' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                </FieldGrid>
              )}
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <KpiGrid>
        <Kpi
          accent
          label="Total debt"
          value={formatMoney(totalDebt)}
          footer={`${facilityCount} liabilit${facilityCount === 1 ? 'y' : 'ies'} · counted once each`}
        />
        <Kpi
          label="Portfolio LVR (collateral pool)"
          value={portfolioLvr.available ? (portfolioLvr.value * 100).toFixed(1) : 'Unavailable'}
          valueSuffix={portfolioLvr.available ? '%' : undefined}
          footer={
            portfolioLvr.available
              ? `Debt ÷ eligible collateral${collateralRangeLabel ? ` · valuations ${collateralRangeLabel}` : ''}`
              : `Debt ÷ eligible collateral · ${portfolioLvr.reason}`
          }
        />
        <Kpi
          label="Monthly repayments"
          value={formatMoney(repayments.total)}
          footer={`${formatMoney(repayments.principal)} principal · ${formatMoney(repayments.interest)} interest`}
        />
        <Kpi
          label="Next rate review"
          value={nextReview ? formatDateShort(nextReview.on) : 'None scheduled'}
          footer={nextReview?.detail ?? 'No fixed terms ending'}
        />
      </KpiGrid>

      <Card>
        <CardHeader title="Facilities" aside={<Sub>Balances as of last statement date</Sub>} />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.loan.id}
          isRowSelected={(row) => row.loan.id === focusLoanId}
          rowStyle={(row) => (row.loan.id === focusLoanId ? { background: 'var(--gold-soft)' } : undefined)}
          empty="No facilities recorded."
        />
      </Card>

      <Sub style={{ fontSize: 12 }}>
        Money lent out is shown as a receivable and is never counted as debt or as an expense (FR-11).
      </Sub>
    </Stack>
  );
}
