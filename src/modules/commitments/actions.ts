'use server';

import { revalidatePath } from 'next/cache';
import { asId, type ProjectId } from '@/shared/types/common';
import { fromMajorUnits } from '@/shared/lib/money';
import { TAX_TREATMENTS } from '@/shared/finance-engine';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { commitmentsService } from './service';
import type { CommitmentAllocation } from './model';

function revalidateProject(projectId: string): void {
  revalidatePath(`/projects/${projectId}/invoices`);
  revalidatePath(`/projects/${projectId}`, 'layout');
}

function readRevision(form: FormData): number | undefined {
  const raw = readString(form, 'revision');
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function strings(form: FormData, key: string): string[] {
  return form.getAll(key).map((value) => (typeof value === 'string' ? value.trim() : ''));
}

/** Repeated allocation rows: `allocCostLineId[]`, `allocAmount[]`, optional `allocStageId[]`. Blank rows are skipped. */
function readAllocations(form: FormData): CommitmentAllocation[] {
  const lines = strings(form, 'allocCostLineId');
  const amounts = strings(form, 'allocAmount');
  const stages = strings(form, 'allocStageId');
  const rows: CommitmentAllocation[] = [];
  lines.forEach((costLineId, index) => {
    const rawAmount = amounts[index] ?? '';
    if (!costLineId && !rawAmount) return;
    if (!costLineId) throw new ValidationError('Choose a cost line for every allocation row.', { fieldErrors: { allocations: [`Row ${index + 1} has an amount but no cost line.`] } });
    const parsed = Number(rawAmount.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(parsed)) throw new ValidationError(`"${rawAmount}" is not a valid amount.`, { fieldErrors: { allocations: [`Row ${index + 1}: enter a number.`] } });
    const stageId = stages[index];
    rows.push({ costLineId: asId<'CostLine'>(costLineId), ...(stageId ? { stageId } : {}), amount: fromMajorUnits(parsed) });
  });
  return rows;
}

/** CST03 — a supplier record for the project. */
export async function createSupplierAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Supplier added', () => {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'budget.edit');
    const supplier = commitmentsService.createSupplier({
      projectId,
      name: requireString(form, 'name', 'Supplier name'),
      ...(readString(form, 'abn') ? { abn: readString(form, 'abn') } : {}),
      ...(readString(form, 'contactReference') ? { contactReference: readString(form, 'contactReference') } : {}),
      actor: accessService.getCurrentUser().id,
    });
    revalidateProject(projectId);
    return supplier;
  });
}

/** CST03 — record a contract, net of GST, split across posting lines. */
export async function createCommitmentAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Commitment recorded as draft', () => {
    accessService.guard('development.read');
    const projectId: ProjectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'budget.edit');
    const amount = readAmount(form, 'originalAmount');
    if (amount === undefined) throw new ValidationError('Enter the contract value (ex GST).', { fieldErrors: { originalAmount: ['The net contract value is required.'] } });
    const supplierId = readString(form, 'supplierId');
    if (!supplierId) throw new ValidationError('Choose the supplier.', { fieldErrors: { supplierId: ['Select a supplier.'] } });

    const stageNames = strings(form, 'stageName');
    const stageAmounts = strings(form, 'stageAmount');
    const stageDates = strings(form, 'stagePlannedDate');
    const stages = stageNames.flatMap((name, index) => {
      const raw = stageAmounts[index] ?? '';
      if (!name && !raw) return [];
      const parsed = Number(raw.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(parsed)) throw new ValidationError(`"${raw}" is not a valid stage amount.`, { fieldErrors: { stages: [`Stage ${index + 1}: enter a number.`] } });
      const plannedDate = stageDates[index];
      return [{ id: `stg-${index + 1}`, name, amount: fromMajorUnits(parsed), ...(plannedDate ? { plannedDate } : {}) }];
    });

    const created = commitmentsService.createCommitment({
      projectId,
      supplierId: asId<'Supplier'>(supplierId),
      reference: requireString(form, 'reference', 'Contract reference'),
      title: requireString(form, 'title', 'Title'),
      originalAmount: fromMajorUnits(amount),
      taxTreatment: readChoice(form, 'taxTreatment', TAX_TREATMENTS) ?? 'standard-gst',
      startDate: requireString(form, 'startDate', 'Start date'),
      ...(readString(form, 'endDate') ? { endDate: readString(form, 'endDate') } : {}),
      ...(readString(form, 'attachmentName') ? { attachmentName: readString(form, 'attachmentName') } : {}),
      stages,
      allocations: readAllocations(form),
      actor: accessService.getCurrentUser().id,
      expectedRevision: readRevision(form),
    });
    revalidateProject(projectId);
    return created;
  });
}

export async function authoriseCommitmentAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Commitment authorised', () => {
    accessService.guard('development.read');
    const commitmentId = asId<'Commitment'>(requireString(form, 'commitmentId', 'Commitment'));
    const commitment = commitmentsService.requireCommitment(commitmentId);
    projectsService.guard(commitment.projectId, 'budget.edit');
    const updated = commitmentsService.authoriseCommitment(commitmentId, accessService.getCurrentUser().id);
    revalidateProject(commitment.projectId);
    return updated;
  });
}

/** CST04 — submit a variation; pending until approved by someone else. */
export async function submitVariationAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Variation submitted · pending approval', () => {
    accessService.guard('development.read');
    const commitmentId = asId<'Commitment'>(requireString(form, 'commitmentId', 'Commitment'));
    const commitment = commitmentsService.requireCommitment(commitmentId);
    projectsService.guard(commitment.projectId, 'budget.edit');
    const amount = readAmount(form, 'amount');
    if (amount === undefined) throw new ValidationError('Enter the variation amount (ex GST).', { fieldErrors: { amount: ['A signed net amount is required.'] } });
    const allocations = readAllocations(form);
    const created = commitmentsService.submitVariation({
      commitmentId,
      reference: requireString(form, 'reference', 'Variation reference'),
      description: requireString(form, 'description', 'Description'),
      amount: fromMajorUnits(amount),
      ...(allocations.length > 0 ? { allocations } : {}),
      actor: accessService.getCurrentUser().id,
    });
    revalidateProject(commitment.projectId);
    return created;
  });
}

/** CST04 / IAM04 — approve or reject; the submitter cannot approve their own. */
export async function decideVariationAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction(
    (variation: { state: string }) => `Variation ${variation.state}`,
    () => {
      accessService.guard('development.read');
      const variationId = asId<'Variation'>(requireString(form, 'variationId', 'Variation'));
      const variation = commitmentsService.requireVariation(variationId);
      projectsService.guard(variation.projectId, 'budget.edit');
      const decision = readChoice(form, 'decision', ['approved', 'rejected'] as const) ?? 'approved';
      const actor = accessService.getCurrentUser().id;
      const updated =
        decision === 'rejected'
          ? commitmentsService.rejectVariation(variationId, actor, readString(form, 'reason') ?? '')
          : commitmentsService.approveVariation(variationId, actor, readString(form, 'reason'));
      revalidateProject(variation.projectId);
      return updated;
    },
  );
}
