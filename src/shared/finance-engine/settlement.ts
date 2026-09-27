/**
 * Sale settlement arithmetic (YLD04, CAL12, F09).
 *
 * Settlement receipt = consideration and adjustments − previously released or
 * applied deposits − purchaser GST withholding − other deductions. Withholding
 * is cash the purchaser pays to the tax authority on the seller's behalf: it is
 * a credit against the seller's GST liability, not a development expense, and
 * is never deducted from profit twice.
 */
import { assertCents, type Cents } from './decimal';

export interface SettlementInput {
  /** Contract consideration including adjustments, tax inclusive. */
  readonly grossConsiderationCents: Cents;
  /** Output GST inside the consideration. */
  readonly outputGstCents: Cents;
  /** Purchaser GST withholding remitted at settlement. */
  readonly withholdingCents: Cents;
  /** Deposits already released to the project or applied to the price. */
  readonly appliedDepositsCents?: Cents;
  /** Other settlement deductions, each classified separately by the caller. */
  readonly otherDeductionsCents?: Cents;
}

export interface SettlementResult {
  readonly cashToSellerCents: Cents;
  /** Credit against the GST liability equal to the withholding. */
  readonly withholdingCreditCents: Cents;
  /** Output GST still to remit after the credit; negative means a refund is due. */
  readonly residualGstCents: Cents;
  readonly netRevenueCents: Cents;
}

export function settlementReceipt(input: SettlementInput): SettlementResult {
  assertCents(input.grossConsiderationCents, 'consideration');
  assertCents(input.outputGstCents, 'output GST');
  assertCents(input.withholdingCents, 'withholding');
  const applied = input.appliedDepositsCents ?? 0;
  const other = input.otherDeductionsCents ?? 0;
  assertCents(applied, 'applied deposits');
  assertCents(other, 'other deductions');

  return {
    cashToSellerCents: input.grossConsiderationCents - applied - input.withholdingCents - other,
    withholdingCreditCents: input.withholdingCents,
    residualGstCents: input.outputGstCents - input.withholdingCents,
    netRevenueCents: input.grossConsiderationCents - input.outputGstCents,
  };
}
