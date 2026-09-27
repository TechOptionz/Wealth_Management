'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { asId } from '@/shared/types/common';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from './service';
import { accessRepository } from './repository';
import { ROLE_LABELS, type AccessRole } from './model';

const INVITABLE_ROLES: readonly AccessRole[] = [
  'operations-delegate',
  'family-contributor',
  'accountant-readonly',
];

/**
 * Switch the active test persona (NFR-01 testing aid).
 *
 * Revalidates the whole layout: the sidebar, badges and every page depend on
 * who is signed in, so nothing rendered for the previous user may be reused.
 */
export async function switchUserAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(
    (user: { readonly name: string }) => `Now acting as ${user.name}`,
    () => {
      const userId = requireString(form, 'userId', 'User');
      const user = accessService.switchUser(asId<'User'>(userId));
      revalidatePath('/', 'layout');
      return user;
    },
  );
}

/**
 * Invite someone (NFR-01).
 *
 * Grants are scoped from the outset — an invitation without a scope would grant
 * whole-portfolio access by omission, which is the opposite of deny-by-default.
 * External read-only grants must also be time-limited.
 */
export async function inviteAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Invitation recorded · no email sent in this build', () => {
    accessService.requireCapability(accessService.currentScope(), 'access.write');

    const role = readChoice(form, 'role', INVITABLE_ROLES);
    if (!role) {
      throw new ValidationError('Choose a role.', { fieldErrors: { role: ['A role is required.'] } });
    }

    const expiresOn = readString(form, 'expiresOn');
    if (role === 'accountant-readonly' && !expiresOn) {
      throw new ValidationError('External read-only grants must have an expiry date.', {
        fieldErrors: { expiresOn: ['Set an expiry date for an external reviewer.'] },
      });
    }

    const name = requireString(form, 'name', 'Name');
    const email = requireString(form, 'email', 'Email');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ValidationError('Enter a valid email address.', {
        fieldErrors: { email: ['That does not look like an email address.'] },
      });
    }

    const userId = asId<'User'>(`usr-${randomUUID()}`);
    const isExternal = role === 'accountant-readonly';

    accessRepository.insertUser({
      id: userId,
      name,
      emailMasked: `${email.split('@')[0]}@…`,
      role,
      external: isExternal,
      // Privileged roles require MFA; a family contributor does not.
      mfa: role === 'family-contributor' ? 'not-required' : 'on',
    });

    const propertyIds = form.getAll('propertyIds').filter((v): v is string => typeof v === 'string');
    const grant = accessRepository.insertGrant({
      id: `grant-${randomUUID()}`,
      userId,
      scope: propertyIds.length > 0 ? 'restricted' : 'restricted',
      propertyIds: propertyIds.map((id) => asId<'Property'>(id)),
      entityIds: [],
      canSee: readString(form, 'canSee') ?? `${ROLE_LABELS[role]} · assigned records only`,
      ...(expiresOn ? { expiresOn, canSeeNote: `Grant expires ${expiresOn}` } : {}),
      lastActiveAt: new Date().toISOString(),
      lastActiveLabel: 'Not yet signed in',
    });

    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Access granted · ${name}`,
      context: `${ROLE_LABELS[role]} · ${propertyIds.length} propert${propertyIds.length === 1 ? 'y' : 'ies'}${expiresOn ? ` · expires ${expiresOn}` : ''}`,
    });
    revalidatePath('/access');
    return grant;
  });
}
