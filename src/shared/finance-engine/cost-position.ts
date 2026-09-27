/**
 * The per-cost-line decomposition (§11.2, CAL06, CAL07).
 *
 *   B    approved baseline cost
 *   Cj   revised authorised value of commitment j
 *   Ij   approved invoice cost allocated to commitment j, net of cost credits
 *   I    all approved invoice cost on the line, including direct spend
 *   P    settled cash allocated to that approved cost, net of refunds
 *   A    approved unpaid obligation = I − P − non-cash settlements
 *   R    Σj max(Cj − Ij, 0)   — per commitment, so one contract's underspend
 *                                cannot hide another's overrun
 *   U    uncommitted remaining forecast allowance
 *   EAC  I + R + U
 *
 * Every figure is on one consistent basis (gross or economic); mixing them is
 * the caller's error, not something this file can detect.
 */
import { assertCents, type Cents } from './decimal';

export interface CommitmentPosition {
  readonly id: string;
  /** Original contract value plus approved variations. */
  readonly revisedValueCents: Cents;
  /** Approved invoice cost allocated to this commitment, net of valid cost credits. */
  readonly approvedInvoicedCents: Cents;
}

export interface CostLinePositionInput {
  /** Null before a baseline is published — variance is then not available. */
  readonly baselineCents: Cents | null;
  readonly commitments: readonly CommitmentPosition[];
  /** Approved invoice cost not allocated to any commitment. */
  readonly directSpendApprovedCents: Cents;
  /** Settled cash allocated to approved cost on this line, net of refunds (P). */
  readonly settledCashCents: Cents;
  /** Applied credits, withholding and other non-cash settlement allocations (CAL07). */
  readonly nonCashSettledCents?: Cents;
  /** Remaining uncommitted forecast allowance (U). */
  readonly uncommittedAllowanceCents: Cents;
}

export interface CostLinePosition {
  /** I */
  readonly approvedCostCents: Cents;
  /** A */
  readonly approvedUnpaidCents: Cents;
  /** R */
  readonly unbilledCommitmentCents: Cents;
  /** U */
  readonly uncommittedAllowanceCents: Cents;
  /** Σ Cj */
  readonly committedCents: Cents;
  /** P */
  readonly settledCashCents: Cents;
  /** EAC = I + R + U */
  readonly expectedFinalCostCents: Cents;
  /** EAC − P − non-cash settlements */
  readonly remainingCashCents: Cents;
  /** EAC − B; positive is adverse for a cost. Null without a baseline. */
  readonly varianceCents: Cents | null;
}

export function costLinePosition(input: CostLinePositionInput): CostLinePosition {
  assertCents(input.directSpendApprovedCents, 'direct spend');
  assertCents(input.settledCashCents, 'settled cash');
  assertCents(input.uncommittedAllowanceCents, 'uncommitted allowance');
  if (input.baselineCents !== null) assertCents(input.baselineCents, 'baseline');
  const nonCash = input.nonCashSettledCents ?? 0;
  assertCents(nonCash, 'non-cash settlements');

  let committed = 0;
  let invoicedAgainstCommitments = 0;
  let unbilled = 0;
  for (const commitment of input.commitments) {
    assertCents(commitment.revisedValueCents, `commitment ${commitment.id} value`);
    assertCents(commitment.approvedInvoicedCents, `commitment ${commitment.id} invoiced`);
    committed += commitment.revisedValueCents;
    invoicedAgainstCommitments += commitment.approvedInvoicedCents;
    unbilled += Math.max(commitment.revisedValueCents - commitment.approvedInvoicedCents, 0);
  }

  const approvedCost = invoicedAgainstCommitments + input.directSpendApprovedCents;
  const approvedUnpaid = approvedCost - input.settledCashCents - nonCash;
  const expectedFinalCost = approvedCost + unbilled + input.uncommittedAllowanceCents;

  return {
    approvedCostCents: approvedCost,
    approvedUnpaidCents: approvedUnpaid,
    unbilledCommitmentCents: unbilled,
    uncommittedAllowanceCents: input.uncommittedAllowanceCents,
    committedCents: committed,
    settledCashCents: input.settledCashCents,
    expectedFinalCostCents: expectedFinalCost,
    remainingCashCents: expectedFinalCost - input.settledCashCents - nonCash,
    varianceCents: input.baselineCents === null ? null : expectedFinalCost - input.baselineCents,
  };
}

/**
 * A summary row's figures are the sum of its posting rows and nothing else
 * (CF03, F02): a parent never adds its own amount again.
 */
export function sumPositions(positions: readonly CostLinePosition[]): CostLinePosition {
  const anyBaseline = positions.some((position) => position.varianceCents !== null);
  return positions.reduce<CostLinePosition>(
    (total, position) => ({
      approvedCostCents: total.approvedCostCents + position.approvedCostCents,
      approvedUnpaidCents: total.approvedUnpaidCents + position.approvedUnpaidCents,
      unbilledCommitmentCents: total.unbilledCommitmentCents + position.unbilledCommitmentCents,
      uncommittedAllowanceCents: total.uncommittedAllowanceCents + position.uncommittedAllowanceCents,
      committedCents: total.committedCents + position.committedCents,
      settledCashCents: total.settledCashCents + position.settledCashCents,
      expectedFinalCostCents: total.expectedFinalCostCents + position.expectedFinalCostCents,
      remainingCashCents: total.remainingCashCents + position.remainingCashCents,
      varianceCents: anyBaseline ? (total.varianceCents ?? 0) + (position.varianceCents ?? 0) : null,
    }),
    {
      approvedCostCents: 0,
      approvedUnpaidCents: 0,
      unbilledCommitmentCents: 0,
      uncommittedAllowanceCents: 0,
      committedCents: 0,
      settledCashCents: 0,
      expectedFinalCostCents: 0,
      remainingCashCents: 0,
      varianceCents: anyBaseline ? 0 : null,
    },
  );
}
