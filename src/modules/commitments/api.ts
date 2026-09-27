/**
 * Transport-agnostic handlers for the commitments module.
 *
 * Every handler opens with the platform capability guard and the per-project
 * guard (NFR-01, IAM02). Reads need `financials.read`; commitment and
 * variation writes need `budget.edit`; approving a variation additionally
 * needs an actor other than the submitter, which the service enforces.
 */
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { decimalStringToCents } from '@/server/http/v1';
import { money, type Money } from '@/shared/lib/money';
import type { TaxTreatment } from '@/shared/finance-engine';
import { asId, type CommitmentId, type ProjectId, type VariationId } from '@/shared/types/common';
import { commitmentsService } from './service';
import type { Commitment, CommitmentAllocation, Supplier, Variation } from './model';
import type { CreateCommitmentBody, CreateSupplierBody, DecideVariationBody, SubmitVariationBody } from './validation';

export interface CommitmentSummary {
  readonly commitment: Commitment;
  readonly supplierName: string;
  /** Net. */
  readonly revisedValue: Money;
  /** Net. */
  readonly pendingVariations: Money;
  readonly variations: readonly Variation[];
}

function toAllocations(rows: readonly { costLineId: string; stageId?: string; amount: string }[]): CommitmentAllocation[] {
  return rows.map((row) => ({
    costLineId: asId<'CostLine'>(row.costLineId),
    ...(row.stageId ? { stageId: row.stageId } : {}),
    amount: money(decimalStringToCents(row.amount)),
  }));
}

export const commitmentsApi = {
  list(rawProjectId: string): { readonly suppliers: readonly Supplier[]; readonly items: readonly CommitmentSummary[] } {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'financials.read');
    const suppliers = commitmentsService.listSuppliers(projectId);
    const items = commitmentsService.listCommitments(projectId).map((commitment) => ({
      commitment,
      supplierName: suppliers.find((row) => row.id === commitment.supplierId)?.name ?? 'Unknown supplier',
      revisedValue: commitmentsService.revisedValue(commitment.id),
      pendingVariations: commitmentsService.pendingVariationsTotal(commitment.id),
      variations: commitmentsService.listVariations(commitment.id),
    }));
    return { suppliers, items };
  },

  createSupplier(rawProjectId: string, body: CreateSupplierBody): Supplier {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'budget.edit');
    return commitmentsService.createSupplier({ projectId, ...body, actor: accessService.getCurrentUser().id });
  },

  create(rawProjectId: string, body: CreateCommitmentBody, expectedRevision?: number): Commitment {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(rawProjectId);
    projectsService.guard(projectId, 'budget.edit');
    return commitmentsService.createCommitment({
      projectId,
      supplierId: asId<'Supplier'>(body.supplierId),
      reference: body.reference,
      title: body.title,
      originalAmount: money(decimalStringToCents(body.originalAmount)),
      taxTreatment: body.taxTreatment as TaxTreatment,
      startDate: body.startDate,
      ...(body.endDate ? { endDate: body.endDate } : {}),
      ...(body.attachmentName ? { attachmentName: body.attachmentName } : {}),
      stages: body.stages.map((stage) => ({
        ...(stage.id ? { id: stage.id } : {}),
        name: stage.name,
        amount: money(decimalStringToCents(stage.amount)),
        ...(stage.plannedDate ? { plannedDate: stage.plannedDate } : {}),
      })),
      allocations: toAllocations(body.allocations),
      actor: accessService.getCurrentUser().id,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    });
  },

  authorise(rawCommitmentId: string): Commitment {
    accessService.guard('development.read');
    const commitmentId: CommitmentId = asId<'Commitment'>(rawCommitmentId);
    const commitment = commitmentsService.requireCommitment(commitmentId);
    projectsService.guard(commitment.projectId, 'budget.edit');
    return commitmentsService.authoriseCommitment(commitmentId, accessService.getCurrentUser().id);
  },

  submitVariation(rawCommitmentId: string, body: SubmitVariationBody): Variation {
    accessService.guard('development.read');
    const commitmentId: CommitmentId = asId<'Commitment'>(rawCommitmentId);
    const commitment = commitmentsService.requireCommitment(commitmentId);
    projectsService.guard(commitment.projectId, 'budget.edit');
    return commitmentsService.submitVariation({
      commitmentId,
      reference: body.reference,
      description: body.description,
      amount: money(decimalStringToCents(body.amount)),
      ...(body.allocations ? { allocations: toAllocations(body.allocations) } : {}),
      actor: accessService.getCurrentUser().id,
    });
  },

  decideVariation(rawVariationId: string, body: DecideVariationBody): Variation {
    accessService.guard('development.read');
    const variationId: VariationId = asId<'Variation'>(rawVariationId);
    const variation = commitmentsService.requireVariation(variationId);
    projectsService.guard(variation.projectId, 'budget.edit');
    const actor = accessService.getCurrentUser().id;
    return body.decision === 'rejected'
      ? commitmentsService.rejectVariation(variationId, actor, body.reason ?? '')
      : commitmentsService.approveVariation(variationId, actor, body.reason);
  },
};
