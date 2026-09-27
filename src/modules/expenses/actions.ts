'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { asId } from '@/shared/types/common';
import { fromMajorUnits } from '@/shared/lib/money';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { expensesService } from './service';
import { expensesRepository } from './repository';
import type { AmountBasis } from '@/shared/types/amounts';
import type { Expense, ExpenseCategory } from './model';

const CATEGORIES: readonly ExpenseCategory[] = [
  'insurance', 'rates', 'utilities', 'repairs', 'management',
  'body-corporate', 'compliance', 'loan-interest', 'professional', 'other',
];
const BASES: readonly AmountBasis[] = ['actual', 'forecast', 'estimated'];

function revalidate(): void {
  revalidatePath('/expenses');
  revalidatePath('/dashboard');
}

/** Record an expense (FR-04). */
export async function createExpenseAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Expense recorded', () => {
    const actor = accessService.getCurrentUser();
    const amount = readAmount(form, 'amount');
    if (amount === undefined || amount <= 0) {
      throw new ValidationError('Enter an amount greater than zero.', {
        fieldErrors: { amount: ['An expense must be greater than zero.'] },
      });
    }

    const propertyId = readString(form, 'propertyId');
    const evidenceId = readString(form, 'evidenceDocumentId');
    const now = new Date().toISOString();

    const expense: Expense = {
      id: `exp-${randomUUID()}`,
      source: { kind: 'manual', enteredBy: actor.id },
      revisions: [
        {
          version: 1,
          amount: fromMajorUnits(amount),
          category: readChoice(form, 'category', CATEGORIES) ?? 'other',
          effectiveOn: requireString(form, 'effectiveOn', 'Effective date'),
          allocation: {
            entityId: asId<'Entity'>(requireString(form, 'entityId', 'Entity')),
            ...(propertyId ? { propertyId: asId<'Property'>(propertyId) } : {}),
          },
          basis: readChoice(form, 'basis', BASES) ?? 'actual',
          description: requireString(form, 'description', 'Description'),
          postedAt: now,
          recordedBy: actor.id,
        },
      ],
      evidenceDocumentIds: evidenceId ? [asId<'Document'>(evidenceId)] : [],
    };

    const created = expensesRepository.insert(expense);
    accessService.record({
      actor: actor.name,
      summary: `Expense recorded · ${expense.revisions[0]?.description ?? ''}`,
      context: `Effective ${expense.revisions[0]?.effectiveOn} · ${evidenceId ? 'evidence attached' : 'no evidence'}`,
    });
    revalidate();
    return created;
  });
}

/**
 * Correct an expense.
 *
 * Appends a revision; it cannot overwrite one. The reason is mandatory, because
 * "who changed what and when" is only answerable if the why travels with it.
 */
export async function correctExpenseAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Correction recorded as a new version', () => {
    const amount = readAmount(form, 'amount');
    const category = readChoice(form, 'category', CATEGORIES);
    const effectiveOn = readString(form, 'effectiveOn');
    const description = readString(form, 'description');

    const result = expensesService.correct({
      expenseId: requireString(form, 'expenseId', 'Expense'),
      changes: {
        ...(amount !== undefined ? { amount: fromMajorUnits(amount) } : {}),
        ...(category ? { category } : {}),
        ...(effectiveOn ? { effectiveOn } : {}),
        ...(description ? { description } : {}),
      },
      reason: requireString(form, 'reason', 'Reason'),
      actor: accessService.getCurrentUser().id,
    });
    revalidate();
    return result;
  });
}

/** Withdraw an expense from totals. The record and every revision remain. */
export async function voidExpenseAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Expense voided · excluded from totals, record retained', () => {
    const result = expensesService.void(
      requireString(form, 'expenseId', 'Expense'),
      requireString(form, 'reason', 'Reason'),
      accessService.getCurrentUser().id,
    );
    revalidate();
    return result;
  });
}
