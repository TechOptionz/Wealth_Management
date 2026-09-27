/**
 * The funding order and closing-cash equation (FIN04, CF08, CAL14, CAL17, F11).
 *
 * The pilot policy is deterministic: planned equity first, then available debt
 * in draw rank. Whatever the authorised sources cannot cover is returned as an
 * **unfunded** amount and left visible — nothing here invents a balancing loan
 * or raises an investor's commitment. Cash above the configured reserve repays
 * debt in repayment rank before anything becomes distributable.
 */
import { assertCents, type Cents } from './decimal';

export interface FundingSource {
  readonly id: string;
  /** Lower ranks are used first. */
  readonly rank: number;
  readonly availableCents: Cents;
}

export interface FundingDraw {
  readonly id: string;
  readonly cents: Cents;
}

export interface FundingOrderResult {
  readonly equityDraws: readonly FundingDraw[];
  readonly debtDraws: readonly FundingDraw[];
  readonly unfundedCents: Cents;
}

function drawFrom(needCents: Cents, sources: readonly FundingSource[]): { readonly draws: FundingDraw[]; readonly remaining: Cents } {
  const draws: FundingDraw[] = [];
  let remaining = needCents;
  const ordered = [...sources].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  for (const source of ordered) {
    assertCents(source.availableCents, `${source.id} availability`);
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(source.availableCents, 0));
    if (take > 0) {
      draws.push({ id: source.id, cents: take });
      remaining -= take;
    }
  }
  return { draws, remaining };
}

/** Cover a cash need from equity commitments first, then ranked debt (FIN04). */
export function applyFundingOrder(input: {
  readonly needCents: Cents;
  readonly equitySources: readonly FundingSource[];
  readonly debtSources: readonly FundingSource[];
}): FundingOrderResult {
  assertCents(input.needCents, 'need');
  if (input.needCents <= 0) return { equityDraws: [], debtDraws: [], unfundedCents: 0 };
  const equity = drawFrom(input.needCents, input.equitySources);
  const debt = drawFrom(equity.remaining, input.debtSources);
  return { equityDraws: equity.draws, debtDraws: debt.draws, unfundedCents: debt.remaining };
}

export interface RepaymentTarget {
  readonly id: string;
  /** Lower ranks are repaid first. */
  readonly rank: number;
  readonly outstandingCents: Cents;
}

export interface RepaymentOrderResult {
  readonly repayments: readonly FundingDraw[];
  /** Cash left after the reserve is topped up and debt repaid. */
  readonly distributableCents: Cents;
  readonly reserveTopUpCents: Cents;
}

/** Surplus cash tops up the reserve, repays debt in repayment rank, and only then is distributable. */
export function applyRepaymentOrder(input: {
  readonly surplusCents: Cents;
  readonly minimumReserveCents: Cents;
  readonly reserveHeldCents: Cents;
  readonly facilities: readonly RepaymentTarget[];
  readonly repayExcess: boolean;
}): RepaymentOrderResult {
  assertCents(input.surplusCents, 'surplus');
  assertCents(input.minimumReserveCents, 'minimum reserve');
  assertCents(input.reserveHeldCents, 'reserve held');
  let remaining = Math.max(input.surplusCents, 0);
  const reserveTopUp = Math.min(remaining, Math.max(input.minimumReserveCents - input.reserveHeldCents, 0));
  remaining -= reserveTopUp;

  const repayments: FundingDraw[] = [];
  if (input.repayExcess) {
    const ordered = [...input.facilities].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    for (const facility of ordered) {
      assertCents(facility.outstandingCents, `${facility.id} outstanding`);
      if (remaining <= 0) break;
      const pay = Math.min(remaining, Math.max(facility.outstandingCents, 0));
      if (pay > 0) {
        repayments.push({ id: facility.id, cents: pay });
        remaining -= pay;
      }
    }
  }
  return { repayments, distributableCents: remaining, reserveTopUpCents: reserveTopUp };
}

export interface ClosingCashInput {
  readonly openingCents: Cents;
  readonly receiptsCents: Cents;
  readonly taxRefundsCents: Cents;
  readonly equityContributionsCents: Cents;
  readonly debtDrawsCents: Cents;
  readonly developmentPaymentsCents: Cents;
  readonly taxRemittancesCents: Cents;
  readonly cashFinanceCostsCents: Cents;
  readonly principalRepaymentsCents: Cents;
  readonly distributionsCents: Cents;
}

/** CAL14: closing unrestricted cash. Every term is a positive magnitude; the sign is in the equation. */
export function closingUnrestrictedCash(input: ClosingCashInput): Cents {
  for (const [label, value] of Object.entries(input)) assertCents(value, label);
  return (
    input.openingCents +
    input.receiptsCents +
    input.taxRefundsCents +
    input.equityContributionsCents +
    input.debtDrawsCents -
    input.developmentPaymentsCents -
    input.taxRemittancesCents -
    input.cashFinanceCostsCents -
    input.principalRepaymentsCents -
    input.distributionsCents
  );
}

/** CAL15: facility closing principal. Cash interest never increases principal. */
export function closingPrincipal(input: {
  readonly openingCents: Cents;
  readonly cashDrawsCents: Cents;
  readonly capitalisedCents: Cents;
  readonly principalRepaymentsCents: Cents;
}): Cents {
  for (const [label, value] of Object.entries(input)) assertCents(value, label);
  return input.openingCents + input.cashDrawsCents + input.capitalisedCents - input.principalRepaymentsCents;
}

/** Bounded fixed-point iteration for policies that feed back on themselves (CAL17). */
export const FUNDING_MAX_ITERATIONS = 100;
export const FUNDING_TOLERANCE_CENTS = 1;
