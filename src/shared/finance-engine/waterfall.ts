/**
 * The pilot distribution waterfall (WFL01–WFL03, F10, F12).
 *
 * Tier order is fixed and explicit: required debt, project reserve, return of
 * contributed capital, accrued simple preferred return, then residual profit
 * on the declared split. A tier is paid only from what is left after the tiers
 * above it; a shortfall carries forward as an unmet entitlement and never
 * becomes a negative distribution. Pro rata shares use `allocateProRata`, so
 * the residual cent goes to the last participant by stable id.
 */
import { allocateProRata } from './allocation';
import { assertCents, type Cents } from './decimal';

export interface WaterfallParticipant {
  readonly id: string;
  /** Contributions less capital already returned. */
  readonly outstandingCapitalCents: Cents;
  /** Preferred return accrued and not yet paid. */
  readonly accruedPreferredCents: Cents;
  /** Share of residual profit; shares are relative weights and need not sum to one. */
  readonly residualShareWeight: number;
}

export interface WaterfallInput {
  readonly availableCashCents: Cents;
  readonly requiredDebtCents: Cents;
  readonly reserveCents: Cents;
  readonly participants: readonly WaterfallParticipant[];
}

export interface ParticipantAllocation {
  readonly participantId: string;
  readonly capitalReturnCents: Cents;
  readonly preferredReturnCents: Cents;
  readonly residualProfitCents: Cents;
  readonly totalCents: Cents;
  readonly capitalShortfallCents: Cents;
  readonly preferredShortfallCents: Cents;
}

export interface WaterfallResult {
  readonly debtPaidCents: Cents;
  readonly reserveRetainedCents: Cents;
  readonly allocations: readonly ParticipantAllocation[];
  readonly totalDistributedCents: Cents;
  /** Cash left after every tier, normally zero. */
  readonly residualCashCents: Cents;
  readonly debtShortfallCents: Cents;
  readonly reserveShortfallCents: Cents;
}

export function runWaterfall(input: WaterfallInput): WaterfallResult {
  assertCents(input.availableCashCents, 'available cash');
  assertCents(input.requiredDebtCents, 'required debt');
  assertCents(input.reserveCents, 'reserve');
  for (const participant of input.participants) {
    assertCents(participant.outstandingCapitalCents, `${participant.id} capital`);
    assertCents(participant.accruedPreferredCents, `${participant.id} preferred`);
  }

  // WFL03: distributions come only from positive available cash.
  let remaining = Math.max(input.availableCashCents, 0);

  const debtPaid = Math.min(remaining, Math.max(input.requiredDebtCents, 0));
  remaining -= debtPaid;
  const reserveRetained = Math.min(remaining, Math.max(input.reserveCents, 0));
  remaining -= reserveRetained;

  const ordered = [...input.participants].sort((a, b) => a.id.localeCompare(b.id));

  const capitalReturns = payTier(
    remaining,
    ordered.map((participant) => ({ id: participant.id, entitlement: Math.max(participant.outstandingCapitalCents, 0) })),
  );
  remaining -= capitalReturns.paidCents;

  const preferredReturns = payTier(
    remaining,
    ordered.map((participant) => ({ id: participant.id, entitlement: Math.max(participant.accruedPreferredCents, 0) })),
  );
  remaining -= preferredReturns.paidCents;

  const residualWeights = ordered.filter((participant) => participant.residualShareWeight > 0);
  const residualSplit =
    remaining > 0 && residualWeights.length > 0
      ? allocateProRata(
          remaining,
          residualWeights.map((participant) => ({ id: participant.id, weight: participant.residualShareWeight })),
        )
      : [];
  const residualPaid = residualSplit.reduce((sum, part) => sum + part.cents, 0);
  remaining -= residualPaid;

  const allocations = ordered.map((participant): ParticipantAllocation => {
    const capitalReturnCents = capitalReturns.byId.get(participant.id) ?? 0;
    const preferredReturnCents = preferredReturns.byId.get(participant.id) ?? 0;
    const residualProfitCents = residualSplit.find((part) => part.id === participant.id)?.cents ?? 0;
    return {
      participantId: participant.id,
      capitalReturnCents,
      preferredReturnCents,
      residualProfitCents,
      totalCents: capitalReturnCents + preferredReturnCents + residualProfitCents,
      capitalShortfallCents: Math.max(participant.outstandingCapitalCents, 0) - capitalReturnCents,
      preferredShortfallCents: Math.max(participant.accruedPreferredCents, 0) - preferredReturnCents,
    };
  });

  return {
    debtPaidCents: debtPaid,
    reserveRetainedCents: reserveRetained,
    allocations,
    totalDistributedCents: allocations.reduce((sum, allocation) => sum + allocation.totalCents, 0),
    residualCashCents: remaining,
    debtShortfallCents: Math.max(input.requiredDebtCents, 0) - debtPaid,
    reserveShortfallCents: Math.max(input.reserveCents, 0) - reserveRetained,
  };
}

/** Pay a tier in full when cash allows, otherwise pro rata to entitlement. */
function payTier(
  availableCents: Cents,
  entitlements: readonly { readonly id: string; readonly entitlement: Cents }[],
): { readonly paidCents: Cents; readonly byId: Map<string, Cents> } {
  const byId = new Map<string, Cents>();
  const total = entitlements.reduce((sum, entry) => sum + entry.entitlement, 0);
  if (total <= 0 || availableCents <= 0) return { paidCents: 0, byId };

  if (availableCents >= total) {
    for (const entry of entitlements) byId.set(entry.id, entry.entitlement);
    return { paidCents: total, byId };
  }

  const shares = allocateProRata(
    availableCents,
    entitlements.filter((entry) => entry.entitlement > 0).map((entry) => ({ id: entry.id, weight: entry.entitlement })),
  );
  for (const share of shares) byId.set(share.id, share.cents);
  return { paidCents: availableCents, byId };
}
