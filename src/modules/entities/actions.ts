'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { asId } from '@/shared/types/common';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { entitiesRepository } from './repository';
import {
  ENTITY_KIND_LABELS,
  isControlRelation,
  type ConsolidationMethod,
  type Entity,
  type EntityKind,
  type RelationKind,
} from './model';

const KINDS: readonly EntityKind[] = ['individual', 'company', 'trust', 'smsf'];
const METHODS: readonly ConsolidationMethod[] = ['look-through', 'manual-summary', 'excluded'];
const RELATION_KINDS: readonly RelationKind[] = [
  'owns', 'director-of', 'trustee-of', 'beneficiary-of', 'member-of', 'borrower-of',
];

/** Two- or three-letter monogram, matching the seeded convention. */
function monogramFor(name: string, kind: EntityKind): string {
  if (kind === 'company') return 'Pty';
  if (kind === 'trust') return 'Tr';
  if (kind === 'smsf') return 'SF';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export async function createEntityAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Entity added', () => {
    const name = requireString(form, 'name', 'Name');
    const kind = readChoice(form, 'kind', KINDS) ?? 'individual';
    const consolidation = readChoice(form, 'consolidation', METHODS) ?? 'look-through';

    const entity: Entity = {
      id: asId<'Entity'>(`ent-${randomUUID()}`),
      name,
      kind,
      descriptor: readString(form, 'descriptor') ?? ENTITY_KIND_LABELS[kind],
      monogram: monogramFor(name, kind),
      consolidation,
      ...(consolidation === 'look-through'
        ? { consolidationNote: 'Consolidated look-through' }
        : { consolidationNote: 'Manual summary · read-only' }),
      valueNote: consolidation === 'look-through' ? 'Included interests' : 'Not included yet',
    };

    const created = entitiesRepository.insertEntity(entity);
    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Entity added · ${name}`,
      context: `${ENTITY_KIND_LABELS[kind]} · ${consolidation}`,
    });
    revalidatePath('/entities');
    revalidatePath('/dashboard');
    return created;
  });
}

/**
 * Record a relationship (FR-01, BR-02).
 *
 * The share/control split is enforced here as well as in the domain guard, so an
 * invalid relationship is refused at the boundary with a message the user can
 * act on rather than throwing deeper in.
 */
export async function createRelationshipAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Relationship recorded', () => {
    const kind = readChoice(form, 'kind', RELATION_KINDS) ?? 'owns';
    const share = readAmount(form, 'sharePercent');
    const subjectEntityId = asId<'Entity'>(requireString(form, 'subjectEntityId', 'Entity'));

    if (kind === 'owns' && share === undefined) {
      throw new ValidationError('An ownership relationship must state a share.', {
        fieldErrors: { sharePercent: ['Enter the ownership percentage.'] },
      });
    }
    if (isControlRelation(kind) && share !== undefined) {
      throw new ValidationError(
        'A control relationship cannot carry an ownership share (BR-02).',
        { fieldErrors: { sharePercent: ['Leave this blank for director, trustee, beneficiary or member links.'] } },
      );
    }

    const propertyId = readString(form, 'targetPropertyId');
    const entityId = readString(form, 'targetEntityId');
    if (Boolean(propertyId) === Boolean(entityId)) {
      throw new ValidationError('Choose exactly one target: a property or an entity.', {
        fieldErrors: { targetPropertyId: ['Pick a property or an entity, not both.'] },
      });
    }

    const created = entitiesRepository.insertRelationship({
      id: `rel-${randomUUID()}`,
      subjectEntityId,
      kind,
      target: propertyId
        ? { type: 'property', propertyId: asId<'Property'>(propertyId) }
        : { type: 'entity', entityId: asId<'Entity'>(entityId!) },
      ...(share !== undefined ? { sharePercent: share } : {}),
      from: requireString(form, 'from', 'Effective from'),
      to: readString(form, 'to') ?? null,
      label: requireString(form, 'label', 'Label'),
    });

    accessService.record({
      actor: accessService.getCurrentUser().name,
      summary: `Relationship recorded · ${created.label}`,
      context: share === undefined ? 'Control relationship · no ownership share' : `${share}% ownership`,
    });
    revalidatePath('/entities');
    revalidatePath('/dashboard');
    return created;
  });
}
