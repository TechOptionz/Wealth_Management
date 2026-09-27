'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { asId } from '@/shared/types/common';
import { fromMajorUnits } from '@/shared/lib/money';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { accessService } from '@/modules/access/service';
import { sharedBillsService } from './service';
import { sharedBillsRepository } from './repository';
import type { SharedBill, SharedBillCategory } from './model';

const CATEGORIES: readonly SharedBillCategory[] = [
  'water', 'electricity', 'gas', 'internet', 'cleaning', 'other',
];

function revalidate(): void {
  revalidatePath('/shared-bills');
  revalidatePath('/expenses');
  revalidatePath('/dashboard');
}

/**
 * Record the outcome of a recoverability review (FR-07).
 *
 * Recoverability is a reviewed input, never a conclusion the platform infers, so
 * this is the only way `recoveryReviewedOn` is ever set.
 */
export async function recordRecoveryReviewAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Recovery review recorded', () => {
    const billId = requireString(form, 'billId', 'Bill');
    const bill = sharedBillsService.require(billId);
    const reviewedOn = requireString(form, 'reviewedOn', 'Review date');
    const deadline = readString(form, 'deadline') ?? null;

    // Validates the agreement precondition before anything is written.
    sharedBillsService.recordRecoveryReview(billId, reviewedOn, deadline);

    const updated = sharedBillsRepository.update(billId, {
      recoveryReviewedOn: reviewedOn,
      recoveryDeadline: deadline,
    });
    if (!updated) throw new ValidationError('That bill no longer exists.');

    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Recovery reviewed · ${bill.supplier} ${bill.reference ?? ''}`.trim(),
      context: `Reviewed ${reviewedOn}${deadline ? ` · deadline ${deadline}` : ' · no deadline recorded'}`,
    });
    revalidate();
    return updated;
  });
}

/**
 * Charge a bill's recoverable shares to the tenants' lease ledgers (FR-07).
 *
 * The service refuses a second posting, so a double-click or a stale tab cannot
 * charge a tenant twice.
 */
export async function postBillToLeasesAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Charged to tenant ledger', () => {
    const billId = requireString(form, 'billId', 'Bill');
    const result = sharedBillsService.postSharesToLeases(
      billId,
      accessService.getCurrentUser().id,
      resolveAsOfDate(),
    );

    revalidate();
    revalidatePath('/leases');
    return result;
  });
}

/** Record a shared bill (FR-07). Its split comes from the property's agreement. */
export async function createSharedBillAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Shared bill recorded', () => {
    const total = readAmount(form, 'total');
    if (total === undefined || total <= 0) {
      throw new ValidationError('Enter a bill total greater than zero.', {
        fieldErrors: { total: ['A bill total must be greater than zero.'] },
      });
    }

    const propertyId = asId<'Property'>(requireString(form, 'propertyId', 'Property'));
    const periodFrom = requireString(form, 'periodFrom', 'Period start');
    const periodTo = requireString(form, 'periodTo', 'Period end');
    if (periodTo < periodFrom) {
      throw new ValidationError('The period end must not be before the period start.', {
        fieldErrors: { periodTo: ['End date is before the start date.'] },
      });
    }

    // The agreement in force for the bill's own date decides the split. Picking
    // it here rather than asking the user is what keeps splits authorised.
    const agreement = sharedBillsRepository
      .listAgreementsForProperty(propertyId)
      .find((entry) => entry.approved && entry.effectiveFrom <= periodTo && (entry.effectiveTo === null || entry.effectiveTo >= periodTo));

    const bill: SharedBill = {
      id: `bill-${randomUUID()}`,
      propertyId,
      category: readChoice(form, 'category', CATEGORIES) ?? 'other',
      supplier: requireString(form, 'supplier', 'Supplier'),
      ...(readString(form, 'reference') ? { reference: readString(form, 'reference')! } : {}),
      total: fromMajorUnits(total),
      periodFrom,
      periodTo,
      dueOn: requireString(form, 'dueOn', 'Due date'),
      effectiveOn: periodTo,
      postedAt: new Date().toISOString(),
      basisAmount: 'actual',
      agreementId: agreement?.id ?? null,
      recoveryReviewedOn: null,
      recoveryDeadline: null,
    };

    const created = sharedBillsRepository.insert(bill);
    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Shared bill recorded · ${created.supplier}`,
      context: agreement
        ? `Split under "${agreement.description}"`
        : 'No approved agreement covers this period · treated as owner cost until one is recorded',
    });
    revalidate();
    return created;
  });
}
