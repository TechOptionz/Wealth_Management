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
import { obligationsService } from './service';
import { obligationsRepository } from './repository';
import { resolveAsOfDate } from '@/shared/config/app-config';
import type { IsoDate } from '@/shared/types/common';
import type { Obligation, Recurrence, SkipReason } from './model';

const RECURRENCES: readonly Recurrence[] = ['once', 'monthly', 'quarterly', 'yearly'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What one run of the reminder job did, for the toast and the audit trail. */
interface ReminderDispatchSummary {
  readonly asOf: IsoDate;
  readonly processed: number;
  readonly sent: number;
  readonly skipped: number;
  readonly skippedByReason: Partial<Record<SkipReason, number>>;
}

/** Every obligations screen reads from these two paths. */
function revalidate(): void {
  revalidatePath('/obligations');
  revalidatePath('/dashboard');
}

/**
 * Close an obligation with payment evidence (FR-03).
 *
 * The document id is required by the service, not merely by this form — a
 * reminder never closes an obligation, and neither does an unevidenced click.
 */
export async function recordPaymentAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Payment evidence recorded · obligation closed', () => {
    const obligationId = asId<'Obligation'>(requireString(form, 'obligationId', 'Obligation'));
    const documentId = readString(form, 'documentId');
    if (!documentId) {
      throw new ValidationError('Choose the document that evidences this payment.', {
        fieldErrors: { documentId: ['Payment evidence is required to close an obligation.'] },
      });
    }

    const result = obligationsService.recordPayment({
      obligationId,
      paidOn: requireString(form, 'paidOn', 'Payment date'),
      documentId,
      actor: accessService.getCurrentUser().id,
    });
    revalidate();
    return result;
  });
}

/** Mark an obligation disputed, which pauses reminders without stopping accrual. */
export async function markDisputedAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Marked disputed · reminders paused', () => {
    const result = obligationsService.markDisputed(
      asId<'Obligation'>(requireString(form, 'obligationId', 'Obligation')),
      accessService.getCurrentUser().id,
    );
    revalidate();
    return result;
  });
}

/** Assign an owner — the act that makes an obligation reminder-eligible (FR-08). */
export async function assignOwnerAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Owner assigned · now eligible for reminders', () => {
    const result = obligationsService.assignOwner(
      asId<'Obligation'>(requireString(form, 'obligationId', 'Obligation')),
      asId<'User'>(requireString(form, 'ownerUserId', 'Owner')),
      accessService.getCurrentUser().id,
    );
    revalidate();
    return result;
  });
}

/** Change the reminder offset and channels for one obligation. */
export async function updateReminderAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Reminder schedule updated', () => {
    const obligationId = asId<'Obligation'>(requireString(form, 'obligationId', 'Obligation'));
    const obligation = obligationsService.require(obligationId);

    const daysBefore = Number(requireString(form, 'daysBefore', 'Notice period'));
    if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 90) {
      throw new ValidationError('Notice period must be between 0 and 90 days.', {
        fieldErrors: { daysBefore: ['Enter a whole number of days between 0 and 90.'] },
      });
    }

    const enabled = readChoice(form, 'enabled', ['on', 'off'] as const) === 'on';
    const updated = obligationsRepository.update(obligationId, {
      reminderPolicy: { ...obligation.reminderPolicy, daysBefore, enabled },
    });
    if (!updated) throw new ValidationError('That obligation no longer exists.');

    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Reminder schedule changed · ${obligation.title}`,
      context: `${daysBefore} days before due · reminders ${enabled ? 'on' : 'off'}`,
    });
    revalidate();
    return updated;
  });
}

/**
 * Run the reminder job on demand and report what it did (FR-08).
 *
 * Nothing schedules the job in this build, so this button is the only thing
 * that runs it. The job is idempotent, so pressing it twice sends nothing new.
 */
export async function runReminderDispatchAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (summary: ReminderDispatchSummary) =>
      `Reminder job completed: ${summary.sent} sent, ${summary.skipped} cancelled/skipped`,
    () => {
      const asOf = readString(form, 'asOf') ?? resolveAsOfDate();
      if (!ISO_DATE.test(asOf) || Number.isNaN(Date.parse(asOf))) {
        throw new ValidationError('The dispatch date is not a valid date.', {
          fieldErrors: { asOf: ['Use a date in the form 2026-09-06.'] },
        });
      }

      const results = obligationsService.runReminderJob(asOf);

      const skippedByReason: Partial<Record<SkipReason, number>> = {};
      for (const result of results) {
        if (result.skipReason) {
          skippedByReason[result.skipReason] = (skippedByReason[result.skipReason] ?? 0) + 1;
        }
      }
      const sent = results.filter((result) => result.sent).length;
      const summary: ReminderDispatchSummary = {
        asOf,
        processed: results.length,
        sent,
        skipped: results.length - sent,
        skippedByReason,
      };

      const reasons = Object.entries(skippedByReason)
        .map(([reason, count]) => `${count} ${reason}`)
        .join(', ');
      accessService.record({
        actor: accessService.getCurrentUser().name,
        summary: `Reminder dispatch run · ${summary.sent} sent, ${summary.skipped} cancelled/skipped`,
        context: `As of ${asOf} · ${summary.processed} processed${reasons ? ` · skipped: ${reasons}` : ''}`,
      });
      revalidate();
      return summary;
    },
  );
}

/** Create an obligation (FR-03). */
export async function createObligationAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Obligation created', () => {
    const ownerUserId = readString(form, 'ownerUserId');
    const amount = readAmount(form, 'amount');
    const propertyId = readString(form, 'propertyId');
    const actor = accessService.getCurrentUser();

    const obligation: Obligation = {
      id: asId<'Obligation'>(`obl-${randomUUID()}`),
      title: requireString(form, 'title', 'Title'),
      contextLabel: readString(form, 'contextLabel') ?? '',
      ...(propertyId ? { propertyId: asId<'Property'>(propertyId) } : {}),
      dueOn: requireString(form, 'dueOn', 'Due date'),
      recurrence: readChoice(form, 'recurrence', RECURRENCES) ?? 'once',
      ownerUserId: ownerUserId ? asId<'User'>(ownerUserId) : null,
      amount: amount === undefined ? null : fromMajorUnits(amount),
      evidence: { state: 'none', label: '—' },
      disputed: false,
      reminderPolicy: {
        enabled: true,
        channels: ['in-app', 'email'],
        daysBefore: 5,
        quietHours: { fromHour: 21, toHour: 8, timezone: 'AEST' },
        escalateAfterDays: 1,
      },
      // Only an owned obligation is validated for reminders; an unowned one is
      // created deliberately un-validated so the gap stays visible.
      ...(ownerUserId ? { validatedAt: new Date().toISOString(), validatedBy: actor.id } : {}),
    };

    const created = obligationsRepository.insert(obligation);
    accessService.record({
      actor: actor.name,
      summary: `Obligation created · ${created.title}`,
      context: `${created.contextLabel} · due ${created.dueOn}${ownerUserId ? '' : ' · no owner assigned'}`,
    });
    revalidate();
    return created;
  });
}
