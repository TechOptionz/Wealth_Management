'use server';

import { revalidatePath } from 'next/cache';
import { asId } from '@/shared/types/common';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readString, requireString } from '@/shared/lib/form-data';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { accessService } from '@/modules/access/service';
import { reconciliationService } from './service';
import { reconciliationRepository } from './repository';

function revalidate(): void {
  revalidatePath('/bank-import');
  revalidatePath('/dashboard');
}

/** Confirm one staged row (FR-06). A suggestion only becomes a posting here. */
export async function confirmTransactionAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Transaction confirmed', () => {
    const result = reconciliationService.confirm({
      transactionId: asId<'BankTransaction'>(requireString(form, 'transactionId', 'Transaction')),
      actor: accessService.getCurrentUser().id,
      ...(readString(form, 'correctionNote') ? { correctionNote: readString(form, 'correctionNote')! } : {}),
    });
    revalidate();
    return result;
  });
}

/**
 * Confirm every high-confidence row at once.
 *
 * Deliberately does not touch low-confidence or unmatched rows — a bulk action
 * must never sweep up something the matcher was unsure about.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- useActionState requires
   both parameters even when this action reads neither. */
export async function confirmAllHighConfidenceAction(
  _previous: ActionResult<unknown>,
  _form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (count) => `Confirmed ${count} high-confidence row${count === 1 ? '' : 's'}`,
    () => {
      const result = reconciliationService.confirmAllHighConfidence(
        requireCurrentImport(),
        accessService.getCurrentUser().id,
      );
      revalidate();
      return result;
    },
  );
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Allocate a row the matcher could not place, then confirm it.
 *
 * The correction is stored alongside the original suggestion rather than
 * replacing it, and the raw bank text is never rewritten (FR-06).
 */
export async function allocateTransactionAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Transaction allocated and confirmed', () => {
    const transactionId = asId<'BankTransaction'>(requireString(form, 'transactionId', 'Transaction'));
    const allocation = readString(form, 'allocation');
    if (!allocation) {
      throw new ValidationError('Choose what this transaction relates to.', {
        fieldErrors: { allocation: ['An allocation is required before a row can be confirmed.'] },
      });
    }

    const note = readString(form, 'note');
    const result = reconciliationService.confirm({
      transactionId,
      actor: accessService.getCurrentUser().id,
      correctionNote: note ? `${allocation} · ${note}` : allocation,
    });
    revalidate();
    return result;
  });
}

/** Leave a row unmatched on purpose, recording that it was reviewed. */
export async function leaveUnmatchedAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Left unmatched · stays unposted', () => {
    const transactionId = asId<'BankTransaction'>(requireString(form, 'transactionId', 'Transaction'));
    const txn = reconciliationRepository.findTransaction(transactionId);
    if (!txn) throw new NotFoundError('Staged transaction', transactionId);
    if (txn.postedAt) {
      throw new ConflictError('This transaction has already been posted to the ledger and can no longer be changed.');
    }

    const updated = reconciliationRepository.updateTransaction(transactionId, { state: 'unmatched' });
    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Transaction left unmatched · ${txn.rawDescription}`,
      context: `${txn.date} · reviewed, stays unposted until allocated`,
    });
    revalidate();
    return updated;
  });
}

/**
 * Post the import's confirmed rows to the ledger — the wizard's final step.
 *
 * Refused while any row still carries an unreviewed suggestion; the service
 * owns that rule, so the button being visible is never what permits a posting.
 */
export async function postImportToLedgerAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Import posted to ledger', () => {
    const result = reconciliationService.postToLedger(
      asId<'BankImport'>(requireString(form, 'importId', 'Bank import')),
      accessService.getCurrentUser().id,
    );
    revalidate();
    return result;
  });
}

/** Next.js caps a Server Action body at 1 MB; refuse earlier, with a message that says why. */
const MAX_STATEMENT_BYTES = 900_000;

/**
 * Start a new import from an uploaded or pasted CSV statement (FR-06).
 *
 * A chosen file wins over the text box, so a leftover paste can never be
 * imported in place of the file the person just picked.
 */
export async function uploadBankCsvAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (created: { readonly staged: number; readonly duplicatesSkipped: number }) =>
      `Statement imported · ${created.staged} row${created.staged === 1 ? '' : 's'} staged${
        created.duplicatesSkipped > 0 ? ` · ${created.duplicatesSkipped} duplicates skipped` : ''
      }`,
    async () => {
      const file = form.get('csvFile');
      const upload = file instanceof File && file.size > 0 ? file : undefined;
      if (upload && upload.size > MAX_STATEMENT_BYTES) {
        throw new ValidationError('That file is too large to be a bank statement.', {
          fieldErrors: { csvFile: ['Choose a CSV under 900 KB, or split the statement by month.'] },
        });
      }

      const csvContent = upload ? await upload.text() : readString(form, 'csvContent');
      if (!csvContent?.trim()) {
        throw new ValidationError('Choose a CSV file or paste the statement text.', {
          fieldErrors: { csvContent: ['Nothing to import yet.'] },
        });
      }
      if (csvContent.length > MAX_STATEMENT_BYTES) {
        throw new ValidationError('That statement is too large to import in one go.', {
          fieldErrors: { csvContent: ['Split the statement by month and import each part.'] },
        });
      }

      const created = reconciliationService.createImportFromCsv({
        accountLabel: readString(form, 'accountLabel') ?? '',
        format: 'CSV',
        csvContent,
        actor: accessService.getCurrentUser().id,
        asOf: resolveAsOfDate(),
      });
      revalidate();
      return {
        ...created,
        staged: reconciliationService.summarise(created.id).staged,
      };
    },
  );
}

function requireCurrentImport() {
  const current = reconciliationService.currentImport();
  if (!current) throw new NotFoundError('Bank import', 'current');
  return current.id;
}
