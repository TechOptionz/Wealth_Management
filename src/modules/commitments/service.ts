/**
 * Commitments business logic (CST03–CST05).
 *
 * A commitment is a net obligation split across posting cost lines; a
 * variation is a separate record that changes the obligation only once it is
 * approved. Everything a screen or the project model reads — revised value,
 * pending risk, per-line shares — is computed here from those records, never
 * stored (§11.2 "derived state is never stored").
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { addMoney, money, sumMoney, type Money } from '@/shared/lib/money';
import { allocateResidualToLast, TAX_TREATMENTS, type TaxTreatment } from '@/shared/finance-engine';
import { asId, type CommitmentId, type CostLineId, type IsoDate, type ProjectId, type SupplierId, type UserId, type VariationId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { budgetsService } from '@/modules/budgets/service';
import { commitmentsRepository } from './repository';
import type { Commitment, CommitmentAllocation, CommitmentLineShare, CommitmentStage, Supplier, Variation } from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateSupplierInput {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly abn?: string;
  readonly contactReference?: string;
  readonly actor: UserId;
}

export interface CreateCommitmentInput {
  readonly projectId: ProjectId;
  readonly supplierId: SupplierId;
  readonly reference: string;
  readonly title: string;
  /** Net (ex GST). */
  readonly originalAmount: Money;
  readonly taxTreatment: TaxTreatment;
  readonly startDate: IsoDate;
  readonly endDate?: IsoDate;
  readonly attachmentName?: string;
  readonly stages: readonly (Omit<CommitmentStage, 'id'> & { readonly id?: string })[];
  readonly allocations: readonly CommitmentAllocation[];
  readonly actor: UserId;
  readonly expectedRevision?: number;
}

export interface SubmitVariationInput {
  readonly commitmentId: CommitmentId;
  readonly reference: string;
  readonly description: string;
  /** Signed net change (ex GST). */
  readonly amount: Money;
  readonly allocations?: readonly CommitmentAllocation[];
  readonly actor: UserId;
}

export interface CloneOptions {
  /** Copy suppliers flagged inactive as well. Default false. */
  readonly includeInactive?: boolean;
  /** Accepted for symmetry with the other modules' clone options; suppliers copy either way. */
  readonly structure?: boolean;
  readonly assumptions?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

/**
 * Every allocation must land on an active posting line of the same project.
 * The cost line record is the budgets module's; this only reads it.
 */
function assertPostingLines(projectId: ProjectId, allocations: readonly CommitmentAllocation[], field = 'allocations'): void {
  for (const allocation of allocations) {
    const line = budgetsService.requireCostLine(allocation.costLineId);
    if (line.projectId !== projectId) {
      throw new ValidationError(`Cost line ${line.code} belongs to another project.`, {
        fieldErrors: { [field]: [`${line.code} is not a cost line of this project.`] },
      });
    }
    if (line.rowType !== 'posting') {
      throw new ValidationError(`${line.code} is a summary row; allocate to a posting line beneath it.`, {
        fieldErrors: { [field]: [`${line.code} is a summary row, not a posting line.`] },
      });
    }
    if (!line.active) {
      throw new ValidationError(`${line.code} is inactive.`, { fieldErrors: { [field]: [`${line.code} is no longer active.`] } });
    }
  }
}

function assertBalanced(parts: readonly Money[], total: Money, what: string, field: string): void {
  const sum = sumMoney(parts);
  if (sum.cents !== total.cents) {
    throw new ValidationError(`${what} must add up to the contract value exactly.`, {
      fieldErrors: { [field]: [`${what} total ${sum.cents / 100} does not equal ${total.cents / 100}.`] },
      details: { sum, total },
    });
  }
}

export const commitmentsService = {
  listSuppliers(projectId: ProjectId): readonly Supplier[] {
    return commitmentsRepository.listSuppliers(projectId);
  },

  requireSupplier(id: SupplierId): Supplier {
    const supplier = commitmentsRepository.findSupplier(id);
    if (!supplier) throw new NotFoundError('Supplier', id);
    return supplier;
  },

  createSupplier(input: CreateSupplierInput): Supplier {
    projectsService.assertMutable(input.projectId);
    const name = input.name.trim();
    if (!name) throw new ValidationError('Enter the supplier name.', { fieldErrors: { name: ['A supplier needs a name.'] } });
    const clash = commitmentsRepository.listSuppliers(input.projectId).find((row) => row.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      throw new ValidationError(`${name} is already a supplier on this project.`, {
        fieldErrors: { name: ['Choose the existing supplier instead of adding it twice.'] },
      });
    }
    const supplier = commitmentsRepository.insertSupplier({
      id: asId<'Supplier'>(`sup-${randomUUID()}`),
      projectId: input.projectId,
      name,
      ...(input.abn?.trim() ? { abn: input.abn.trim() } : {}),
      ...(input.contactReference?.trim() ? { contactReference: input.contactReference.trim() } : {}),
      active: true,
      bankDetailsVerified: false,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Supplier added · ${supplier.name}`,
      context: `${projectsService.require(input.projectId).code} · bank details not yet verified`,
    });
    return supplier;
  },

  listCommitments(projectId: ProjectId): readonly Commitment[] {
    return commitmentsRepository.listCommitments(projectId);
  },

  requireCommitment(id: CommitmentId): Commitment {
    const commitment = commitmentsRepository.findCommitment(id);
    if (!commitment) throw new NotFoundError('Commitment', id);
    return commitment;
  },

  /**
   * CST03 — record a contract. Σ allocations = contract value exactly; when
   * stages are given Σ stages = contract value and every staged allocation
   * names one of them. Cost lines must be posting lines of the same project.
   */
  createCommitment(input: CreateCommitmentInput): Commitment {
    projectsService.assertMutable(input.projectId);
    const supplier = commitmentsService.requireSupplier(input.supplierId);
    if (supplier.projectId !== input.projectId) throw new NotFoundError('Supplier', input.supplierId);

    const reference = input.reference.trim();
    if (!reference) throw new ValidationError('Enter the contract reference.', { fieldErrors: { reference: ['A reference is required.'] } });
    if (commitmentsRepository.findCommitmentByReference(input.projectId, reference)) {
      throw new ValidationError(`Reference ${reference} is already used on this project.`, {
        fieldErrors: { reference: ['Each contract reference must be unique within the project.'] },
      });
    }
    if (!input.title.trim()) throw new ValidationError('Enter a title.', { fieldErrors: { title: ['A commitment needs a title.'] } });
    if (input.originalAmount.cents <= 0) {
      throw new ValidationError('The contract value must be greater than zero.', {
        fieldErrors: { originalAmount: ['Enter the net (ex GST) contract value.'] },
      });
    }
    if (!TAX_TREATMENTS.includes(input.taxTreatment) || input.taxTreatment === 'margin-scheme') {
      throw new ValidationError('Choose a tax treatment other than margin scheme (CAL11).', {
        fieldErrors: { taxTreatment: ['Margin scheme is not available for commitments in this release.'] },
      });
    }
    if (!ISO_DATE.test(input.startDate) || (input.endDate !== undefined && !ISO_DATE.test(input.endDate))) {
      throw new ValidationError('Enter dates as YYYY-MM-DD.', { fieldErrors: { startDate: ['Use YYYY-MM-DD.'] } });
    }
    if (input.endDate !== undefined && input.endDate < input.startDate) {
      throw new ValidationError('The end date must not be before the start date.', {
        fieldErrors: { endDate: ['Choose a date on or after the start date.'] },
      });
    }
    if (input.allocations.length === 0) {
      throw new ValidationError('Allocate the contract value to at least one cost line.', {
        fieldErrors: { allocations: ['Add at least one cost line allocation.'] },
      });
    }
    if (input.allocations.some((allocation) => allocation.amount.cents <= 0)) {
      throw new ValidationError('Each allocation must be greater than zero.', {
        fieldErrors: { allocations: ['Remove empty allocation rows or give them an amount.'] },
      });
    }
    assertBalanced(input.allocations.map((allocation) => allocation.amount), input.originalAmount, 'Cost line allocations', 'allocations');

    const stages: CommitmentStage[] = input.stages.map((stage, index) => ({
      id: stage.id ?? `stg-${randomUUID()}-${index}`,
      name: stage.name.trim(),
      amount: stage.amount,
      ...(stage.plannedDate ? { plannedDate: stage.plannedDate } : {}),
    }));
    if (stages.length > 0) {
      if (stages.some((stage) => !stage.name || stage.amount.cents <= 0)) {
        throw new ValidationError('Each stage needs a name and an amount greater than zero.', {
          fieldErrors: { stages: ['Complete or remove the empty stage rows.'] },
        });
      }
      if (new Set(stages.map((stage) => stage.id)).size !== stages.length) {
        throw new ValidationError('Stage ids must be unique.', { fieldErrors: { stages: ['Two stages share an id.'] } });
      }
      assertBalanced(stages.map((stage) => stage.amount), input.originalAmount, 'Stages', 'stages');
    }
    const stageIds = new Set(stages.map((stage) => stage.id));
    for (const allocation of input.allocations) {
      if (allocation.stageId !== undefined && !stageIds.has(allocation.stageId)) {
        throw new ValidationError(`Allocation names stage "${allocation.stageId}", which is not on this contract.`, {
          fieldErrors: { allocations: ['Every staged allocation must name one of the contract stages.'] },
        });
      }
    }
    assertPostingLines(input.projectId, input.allocations);

    projectsService.bumpRevision(input.projectId, input.expectedRevision);
    const at = now();
    const created = commitmentsRepository.insertCommitment({
      id: asId<'Commitment'>(`cmt-${randomUUID()}`),
      projectId: input.projectId,
      supplierId: input.supplierId,
      reference,
      title: input.title.trim(),
      originalAmount: input.originalAmount,
      taxTreatment: input.taxTreatment,
      startDate: input.startDate,
      ...(input.endDate ? { endDate: input.endDate } : {}),
      state: 'draft',
      ...(input.attachmentName?.trim() ? { attachmentName: input.attachmentName.trim() } : {}),
      stages,
      allocations: input.allocations.map((allocation) => ({
        costLineId: allocation.costLineId,
        ...(allocation.stageId ? { stageId: allocation.stageId } : {}),
        amount: allocation.amount,
      })),
      createdAt: at,
      createdBy: input.actor,
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Commitment created · ${created.reference} · ${supplier.name}`,
      context: `${projectsService.require(input.projectId).code} · net ${created.originalAmount.cents / 100} · ${created.allocations.length} allocation(s) · draft`,
    });
    return created;
  },

  /** A draft becomes an obligation once authorised. Only then does it count in the position. */
  authoriseCommitment(id: CommitmentId, actor: UserId): Commitment {
    const commitment = commitmentsService.requireCommitment(id);
    projectsService.assertMutable(commitment.projectId);
    if (commitment.state !== 'draft') {
      throw new ConflictError(`${commitment.reference} is already ${commitment.state}.`);
    }
    projectsService.bumpRevision(commitment.projectId);
    const updated = commitmentsRepository.updateCommitment(id, { state: 'authorised', authorisedBy: actor, authorisedAt: now() });
    if (!updated) throw new NotFoundError('Commitment', id);
    accessService.record({
      actor: actorName(actor),
      summary: `Commitment authorised · ${updated.reference}`,
      context: `${projectsService.require(updated.projectId).code} · net ${updated.originalAmount.cents / 100}`,
    });
    return updated;
  },

  listVariations(commitmentId: CommitmentId): readonly Variation[] {
    return commitmentsRepository.listVariations(commitmentId);
  },

  listProjectVariations(projectId: ProjectId): readonly Variation[] {
    return commitmentsRepository.listProjectVariations(projectId);
  },

  requireVariation(id: VariationId): Variation {
    const variation = commitmentsRepository.findVariation(id);
    if (!variation) throw new NotFoundError('Variation', id);
    return variation;
  },

  /** CST04 — a variation is submitted against an authorised commitment; it changes nothing until approved. */
  submitVariation(input: SubmitVariationInput): Variation {
    const commitment = commitmentsService.requireCommitment(input.commitmentId);
    projectsService.assertMutable(commitment.projectId);
    if (commitment.state !== 'authorised') {
      throw new ConflictError(`Variations can only be raised against an authorised commitment; ${commitment.reference} is ${commitment.state}.`);
    }
    const reference = input.reference.trim();
    if (!reference) throw new ValidationError('Enter the variation reference.', { fieldErrors: { reference: ['A reference is required.'] } });
    if (commitmentsRepository.listVariations(commitment.id).some((row) => row.reference.toLowerCase() === reference.toLowerCase())) {
      throw new ValidationError(`Variation ${reference} already exists on ${commitment.reference}.`, {
        fieldErrors: { reference: ['Each variation reference must be unique on the contract.'] },
      });
    }
    if (!input.description.trim()) {
      throw new ValidationError('Describe the variation.', { fieldErrors: { description: ['A description is required.'] } });
    }
    if (input.amount.cents === 0) {
      throw new ValidationError('A variation must change the contract value.', {
        fieldErrors: { amount: ['Enter a positive or negative net amount.'] },
      });
    }
    if (input.allocations && input.allocations.length > 0) {
      assertBalanced(input.allocations.map((allocation) => allocation.amount), input.amount, 'Variation allocations', 'allocations');
      assertPostingLines(commitment.projectId, input.allocations);
    }
    projectsService.bumpRevision(commitment.projectId);
    const created = commitmentsRepository.insertVariation({
      id: asId<'Variation'>(`var-${randomUUID()}`),
      projectId: commitment.projectId,
      commitmentId: commitment.id,
      reference,
      description: input.description.trim(),
      amount: input.amount,
      state: 'submitted',
      submittedBy: input.actor,
      submittedAt: now(),
      ...(input.allocations && input.allocations.length > 0 ? { allocations: input.allocations } : {}),
    });
    accessService.record({
      actor: actorName(input.actor),
      summary: `Variation submitted · ${commitment.reference} ${created.reference}`,
      context: `${created.description} · net ${created.amount.cents / 100} · pending, not yet in the obligation`,
    });
    return created;
  },

  /** Approval changes the obligation. The submitter may not approve their own variation (IAM04). */
  approveVariation(id: VariationId, actor: UserId, reason?: string): Variation {
    const variation = commitmentsService.requireVariation(id);
    projectsService.assertMutable(variation.projectId);
    if (variation.state !== 'submitted') throw new ConflictError(`${variation.reference} is ${variation.state}; only a submitted variation can be approved.`);
    if (variation.submittedBy === actor) {
      throw new ForbiddenError('A variation cannot be approved by the person who submitted it.');
    }
    projectsService.bumpRevision(variation.projectId);
    const updated = commitmentsRepository.updateVariation(id, {
      state: 'approved',
      decidedBy: actor,
      decidedAt: now(),
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    });
    if (!updated) throw new NotFoundError('Variation', id);
    const commitment = commitmentsService.requireCommitment(updated.commitmentId);
    accessService.record({
      actor: actorName(actor),
      summary: `Variation approved · ${commitment.reference} ${updated.reference}`,
      context: `net ${updated.amount.cents / 100} · revised value ${commitmentsService.revisedValue(commitment.id).cents / 100}${reason ? ` · ${reason.trim()}` : ''}`,
    });
    return updated;
  },

  rejectVariation(id: VariationId, actor: UserId, reason: string): Variation {
    const variation = commitmentsService.requireVariation(id);
    projectsService.assertMutable(variation.projectId);
    if (variation.state !== 'submitted') throw new ConflictError(`${variation.reference} is ${variation.state}; only a submitted variation can be rejected.`);
    if (!reason.trim()) throw new ValidationError('Give a reason for rejecting the variation.', { fieldErrors: { reason: ['A reason is required.'] } });
    projectsService.bumpRevision(variation.projectId);
    const updated = commitmentsRepository.updateVariation(id, { state: 'rejected', decidedBy: actor, decidedAt: now(), reason: reason.trim() });
    if (!updated) throw new NotFoundError('Variation', id);
    accessService.record({
      actor: actorName(actor),
      summary: `Variation rejected · ${updated.reference}`,
      context: reason.trim(),
    });
    return updated;
  },

  /** Original contract value plus approved variations, net (CST04). */
  revisedValue(commitmentId: CommitmentId): Money {
    const commitment = commitmentsService.requireCommitment(commitmentId);
    const approved = commitmentsRepository.listVariations(commitmentId).filter((row) => row.state === 'approved');
    return approved.reduce((total, row) => addMoney(total, row.amount), commitment.originalAmount);
  },

  /** Submitted (and draft) variations: risk, not obligation. Net. */
  pendingVariationsTotal(commitmentId: CommitmentId): Money {
    return sumMoney(
      commitmentsRepository
        .listVariations(commitmentId)
        .filter((row) => row.state === 'submitted' || row.state === 'draft')
        .map((row) => row.amount),
    );
  },

  /**
   * The revised value of every authorised commitment, apportioned to cost
   * lines. Approved variations land where they were allocated, or follow the
   * contract's own split when they name no line; the residual cent goes to the
   * last line so the shares always sum to the revised value.
   */
  allocationsByLine(projectId: ProjectId): ReadonlyMap<CostLineId, readonly CommitmentLineShare[]> {
    const result = new Map<CostLineId, CommitmentLineShare[]>();
    for (const commitment of commitmentsRepository.listCommitments(projectId)) {
      if (commitment.state === 'draft') continue;
      const revised = commitmentsService.revisedValue(commitment.id);
      const shares = shareByLine(commitment, commitmentsRepository.listVariations(commitment.id).filter((row) => row.state === 'approved'), revised);
      const supplierName = commitmentsRepository.findSupplier(commitment.supplierId)?.name ?? 'Unknown supplier';
      for (const [costLineId, amount] of shares) {
        const list = result.get(costLineId) ?? [];
        list.push({ commitmentId: commitment.id, supplierName, reference: commitment.reference, amount });
        result.set(costLineId, list);
      }
    }
    return result;
  },

  /** Copy suppliers into another project (PRJ05 clone). Commitments are contracts and never clone. */
  cloneInto(sourceProjectId: ProjectId, targetProjectId: ProjectId, options: CloneOptions, actor: UserId): readonly Supplier[] {
    projectsService.require(sourceProjectId);
    projectsService.assertMutable(targetProjectId);
    const existing = new Set(commitmentsRepository.listSuppliers(targetProjectId).map((row) => row.name.toLowerCase()));
    const copied: Supplier[] = [];
    for (const supplier of commitmentsRepository.listSuppliers(sourceProjectId)) {
      if (!supplier.active && !options.includeInactive) continue;
      if (existing.has(supplier.name.toLowerCase())) continue;
      copied.push(
        commitmentsRepository.insertSupplier({
          ...supplier,
          id: asId<'Supplier'>(`sup-${randomUUID()}`),
          projectId: targetProjectId,
          bankDetailsVerified: false,
        }),
      );
    }
    if (copied.length > 0) {
      accessService.record({
        actor: actorName(actor),
        summary: `Suppliers cloned · ${copied.length} into ${projectsService.require(targetProjectId).code}`,
        context: `From ${projectsService.require(sourceProjectId).code} · bank verification reset`,
      });
    }
    return copied;
  },
};

/** Per-line net shares of a commitment's revised value, summing to it exactly. */
function shareByLine(commitment: Commitment, approvedVariations: readonly Variation[], revised: Money): ReadonlyMap<CostLineId, Money> {
  const order: CostLineId[] = [];
  const weights = new Map<CostLineId, number>();
  const add = (costLineId: CostLineId, cents: number): void => {
    if (!weights.has(costLineId)) order.push(costLineId);
    weights.set(costLineId, (weights.get(costLineId) ?? 0) + cents);
  };
  for (const allocation of commitment.allocations) add(allocation.costLineId, allocation.amount.cents);
  const baseOrder = [...order];
  const baseWeights = baseOrder.map((id) => weights.get(id) ?? 0);

  for (const variation of approvedVariations) {
    if (variation.allocations && variation.allocations.length > 0) {
      for (const allocation of variation.allocations) add(allocation.costLineId, allocation.amount.cents);
    } else if (baseWeights.some((weight) => weight > 0)) {
      const parts = allocateResidualToLast(variation.amount.cents, baseWeights);
      baseOrder.forEach((id, index) => add(id, parts[index] ?? 0));
    }
  }

  const finalWeights = order.map((id) => weights.get(id) ?? 0);
  const usable = finalWeights.every((weight) => weight >= 0) && finalWeights.some((weight) => weight > 0);
  const parts = usable
    ? allocateResidualToLast(revised.cents, finalWeights)
    : allocateResidualToLast(revised.cents, baseOrder.map((id) => Math.max(commitment.allocations.filter((a) => a.costLineId === id).reduce((s, a) => s + a.amount.cents, 0), 0)));
  const ids = usable ? order : baseOrder;
  const result = new Map<CostLineId, Money>();
  ids.forEach((id, index) => result.set(id, money(parts[index] ?? 0)));
  return result;
}
