/**
 * Development Finance — suppliers, commitments and variations (§7: CST03–CST05).
 *
 * Three rules this model makes structural:
 *  1. **A commitment is a net (ex-GST) obligation split across posting cost
 *     lines.** Σ allocations equals the contract value exactly, and when stages
 *     are recorded Σ stages equals it too — the invariants live in the service,
 *     the types make the split explicit (CST03).
 *  2. **Variations are their own records.** Only an approved variation changes
 *     the obligation; a submitted one is risk, shown separately (CST04).
 *  3. **Nothing derived is stored.** Revised value, pending risk and the CST05
 *     contract position are computed on read from these records and the
 *     invoices module's approved allocations and settlements.
 */
import type { TaxTreatment } from '@/shared/finance-engine';
import type { Money } from '@/shared/lib/money';
import type {
  CommitmentId,
  CostLineId,
  IsoDate,
  IsoDateTime,
  ProjectId,
  SupplierId,
  UserId,
  VariationId,
} from '@/shared/types/common';

export interface Supplier {
  readonly id: SupplierId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly abn?: string;
  readonly contactReference?: string;
  readonly active: boolean;
  /** Bank details are verified out of band; the flag records that it happened. */
  readonly bankDetailsVerified: boolean;
}

/** A payment stage of a contract: concept, DA, construction documentation, … */
export interface CommitmentStage {
  readonly id: string;
  readonly name: string;
  /** Net (ex GST). */
  readonly amount: Money;
  readonly plannedDate?: IsoDate;
}

/** How much of a commitment sits on which posting cost line (and stage, when staged). */
export interface CommitmentAllocation {
  readonly costLineId: CostLineId;
  readonly stageId?: string;
  /** Net (ex GST). */
  readonly amount: Money;
}

export type CommitmentState = 'draft' | 'authorised' | 'closed';

export const COMMITMENT_STATE_LABELS: Record<CommitmentState, string> = {
  draft: 'Draft',
  authorised: 'Authorised',
  closed: 'Closed',
};

export interface Commitment {
  readonly id: CommitmentId;
  readonly projectId: ProjectId;
  readonly supplierId: SupplierId;
  /** Contract or purchase-order reference, unique within the project. */
  readonly reference: string;
  readonly title: string;
  /** Original contract value, net of GST (CST03). */
  readonly originalAmount: Money;
  readonly taxTreatment: TaxTreatment;
  readonly startDate: IsoDate;
  readonly endDate?: IsoDate;
  readonly state: CommitmentState;
  readonly authorisedBy?: UserId;
  readonly authorisedAt?: IsoDateTime;
  /** Name of the signed contract file. Bytes are not retained in this build. */
  readonly attachmentName?: string;
  readonly stages: readonly CommitmentStage[];
  /** Σ amounts equals `originalAmount` exactly. */
  readonly allocations: readonly CommitmentAllocation[];
  readonly createdAt: IsoDateTime;
  readonly createdBy: UserId;
}

export type VariationState = 'draft' | 'submitted' | 'approved' | 'rejected';

export const VARIATION_STATE_LABELS: Record<VariationState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export interface Variation {
  readonly id: VariationId;
  readonly projectId: ProjectId;
  readonly commitmentId: CommitmentId;
  readonly reference: string;
  readonly description: string;
  /** Signed net change to the contract value (ex GST). Negative reduces it. */
  readonly amount: Money;
  readonly state: VariationState;
  readonly submittedBy?: UserId;
  readonly submittedAt?: IsoDateTime;
  readonly decidedBy?: UserId;
  readonly decidedAt?: IsoDateTime;
  readonly reason?: string;
  /** Where the change lands. When absent it follows the commitment's own split. */
  readonly allocations?: readonly CommitmentAllocation[];
}

/** One line of `commitmentsService.allocationsByLine`: a commitment's revised value on one cost line. */
export interface CommitmentLineShare {
  readonly commitmentId: CommitmentId;
  readonly supplierName: string;
  readonly reference: string;
  /** Net share of the revised value on this line. */
  readonly amount: Money;
}
