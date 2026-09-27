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
import { leasesService } from './service';
import { leasesRepository } from './repository';
import type { Lease, RentFrequency } from './model';

const FREQUENCIES: readonly RentFrequency[] = ['weekly', 'fortnightly', 'monthly'];

function revalidate(): void {
  revalidatePath('/leases');
  revalidatePath('/properties');
  revalidatePath('/dashboard');
}

/**
 * Create a lease and its expected charges (FR-05).
 *
 * The charges are generated in the same action, so a lease can never exist
 * without the schedule it implies.
 */
export async function createLeaseAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (result) => `Lease created · ${result.charges} expected charges generated`,
    () => {
      const rent = readAmount(form, 'rent');
      if (rent === undefined || rent <= 0) {
        throw new ValidationError('Enter a rent greater than zero.', {
          fieldErrors: { rent: ['Rent must be greater than zero.'] },
        });
      }

      const startsOn = requireString(form, 'startsOn', 'Start date');
      const endsOn = requireString(form, 'endsOn', 'End date');
      if (endsOn <= startsOn) {
        throw new ValidationError('The end date must be after the start date.', {
          fieldErrors: { endsOn: ['End date must be after the start date.'] },
        });
      }

      // A new tenant is created on the fly; picking an existing one reuses it.
      const existingTenantId = readString(form, 'tenantId');
      const tenantName = readString(form, 'tenantName');
      if (!existingTenantId && !tenantName) {
        throw new ValidationError('Choose an existing tenant or enter a new name.', {
          fieldErrors: { tenantName: ['A tenant is required.'] },
        });
      }

      const tenantId = existingTenantId
        ? asId<'Tenant'>(existingTenantId)
        : leasesRepository.insertTenant({
            id: asId<'Tenant'>(`ten-${randomUUID()}`),
            name: tenantName!,
          }).id;

      const componentId = readString(form, 'componentId');
      const bond = readAmount(form, 'bond');

      const lease: Lease = {
        id: asId<'Lease'>(`lease-${randomUUID()}`),
        tenantId,
        propertyId: asId<'Property'>(requireString(form, 'propertyId', 'Property')),
        componentId: componentId ? asId<'PropertyComponent'>(componentId) : null,
        reference: requireString(form, 'reference', 'Billing reference'),
        startsOn,
        endsOn,
        rent: fromMajorUnits(rent),
        frequency: readChoice(form, 'frequency', FREQUENCIES) ?? 'weekly',
        chargeAnchorOn: readString(form, 'chargeAnchorOn') ?? startsOn,
        // Recorded only. The bond handling policy is not approved, so no charge
        // is generated against it (FR-07 / BR-05).
        ...(bond !== undefined ? { bond: fromMajorUnits(bond) } : {}),
        remindersEnabled: readChoice(form, 'reminders', ['on', 'off'] as const) !== 'off',
        disputed: false,
      };

      const created = leasesRepository.insert(lease);
      const charges = leasesService.generateCharges(created.id);

      accessService.record({
        actor: accessService.getCurrentUser().name,
        summary: `Lease created · ${created.reference}`,
        context: `${charges.length} expected charges from ${startsOn} to ${endsOn}`,
      });
      revalidate();
      return { lease: created, charges: charges.length };
    },
  );
}

/** End a lease early, removing only unearned future charges (FR-05). */
export async function terminateLeaseAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (result) =>
      `Lease ended · ${result.removedCharges} unearned charge${result.removedCharges === 1 ? '' : 's'} removed, ${result.keptCharges} kept`,
    () => {
      const result = leasesService.terminate({
        leaseId: asId<'Lease'>(requireString(form, 'leaseId', 'Lease')),
        endsOn: requireString(form, 'endsOn', 'End date'),
        reason: requireString(form, 'reason', 'Reason'),
      });

      accessService.record({
        actor: accessService.getCurrentUser().name,
        summary: `Lease ended early · ${result.lease.reference}`,
        context: `${requireString(form, 'reason', 'Reason')} · receipts and earned charges retained`,
      });
      revalidate();
      return result;
    },
  );
}

/** Record a rent receipt, settling the oldest unpaid charges first (FR-05, BR-05). */
export async function recordRentPaymentAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (result) =>
      `Payment recorded · ${result.chargesSettled} charge${result.chargesSettled === 1 ? '' : 's'} settled`,
    () => {
      const amount = readAmount(form, 'amount');
      if (amount === undefined || amount <= 0) {
        throw new ValidationError('Enter an amount greater than zero.', {
          fieldErrors: { amount: ['A payment must be greater than zero.'] },
        });
      }

      const note = readString(form, 'note');
      const result = leasesService.allocatePaymentToLease({
        leaseId: asId<'Lease'>(requireString(form, 'leaseId', 'Lease')),
        amount: fromMajorUnits(amount),
        receivedOn: requireString(form, 'receivedOn', 'Date received'),
        ...(note ? { note } : {}),
        actor: accessService.getCurrentUser().id,
      });

      revalidate();
      return result;
    },
  );
}

/** Reprice future unpaid charges from an effective date (FR-05). */
export async function changeRentAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (result) => `Rent changed · ${result.repricedCharges} future charge${result.repricedCharges === 1 ? '' : 's'} repriced`,
    () => {
      const rent = readAmount(form, 'rent');
      if (rent === undefined || rent <= 0) {
        throw new ValidationError('Enter a rent greater than zero.', {
          fieldErrors: { rent: ['Rent must be greater than zero.'] },
        });
      }

      const result = leasesService.changeRent({
        leaseId: asId<'Lease'>(requireString(form, 'leaseId', 'Lease')),
        newRent: fromMajorUnits(rent),
        effectiveFrom: requireString(form, 'effectiveFrom', 'Effective date'),
      });

      accessService.record({
        actor: accessService.getCurrentUser().name,
        summary: `Rent changed · ${result.lease.reference}`,
        context: `Paid history unchanged · ${result.repricedCharges} future charges repriced`,
      });
      revalidate();
      return result;
    },
  );
}
