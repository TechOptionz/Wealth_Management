'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { asId } from '@/shared/types/common';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readAmount, readChoice, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { documentsService } from './service';
import { documentsRepository } from './repository';
import type { DocumentLink, DocumentRecord, DocumentType } from './model';

const TYPES: readonly DocumentType[] = [
  'lease', 'insurance-policy', 'bill', 'invoice', 'receipt', 'loan', 'valuation', 'other',
];

function revalidate(): void {
  revalidatePath('/documents');
  revalidatePath('/dashboard');
}

/**
 * Parse a link chosen in the UI.
 *
 * The select carries `type:id:label`, because a link needs all three and a bare
 * id would leave the register unable to say what a document is attached to.
 */
function parseLink(raw: string): DocumentLink {
  const [type, id, ...rest] = raw.split(':');
  const label = rest.join(':');
  if (!type || !id || !label) throw new ValidationError('That link target is not valid.');

  switch (type) {
    case 'property': return { type, propertyId: asId<'Property'>(id), label };
    case 'entity': return { type, entityId: asId<'Entity'>(id), label };
    case 'obligation': return { type, obligationId: id, label };
    case 'lease': return { type, leaseId: id, label };
    case 'loan': return { type, loanId: id, label };
    case 'valuation': return { type, valuationId: id, label };
    default: throw new ValidationError(`Unknown link type "${type}".`);
  }
}

/** Attach a document to a record (FR-04). Links are additive. */
export async function linkDocumentAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Document linked', () => {
    const target = readString(form, 'target');
    if (!target) {
      throw new ValidationError('Choose what this document relates to.', {
        fieldErrors: { target: ['A link target is required.'] },
      });
    }

    const result = documentsService.link(
      asId<'Document'>(requireString(form, 'documentId', 'Document')),
      parseLink(target),
      accessService.getCurrentUser().id,
    );
    revalidate();
    return result;
  });
}

/**
 * Register a document.
 *
 * There is no file storage in this build, so this records the metadata and says
 * so plainly rather than pretending an upload happened.
 */
export async function registerDocumentAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Document registered · metadata only, no file stored', () => {
    const actor = accessService.getCurrentUser();
    const target = readString(form, 'target');
    const sizeMb = readAmount(form, 'sizeMb') ?? 0.5;
    const now = new Date().toISOString();

    const record: DocumentRecord = {
      id: asId<'Document'>(`doc-${randomUUID()}`),
      filename: requireString(form, 'filename', 'File name'),
      type: readChoice(form, 'type', TYPES) ?? 'other',
      ...(readString(form, 'descriptor') ? { descriptor: readString(form, 'descriptor')! } : {}),
      links: target ? [parseLink(target)] : [],
      uploadedOn: now.slice(0, 10),
      uploadedBy: actor.id,
      versions: [
        {
          version: 1,
          uploadedAt: now,
          uploadedBy: actor.id,
          sizeBytes: Math.max(1, Math.round(sizeMb * 1_000_000)),
        },
      ],
      aiExtractionApproved: false,
    };

    const created = documentsRepository.insert(record);
    accessService.record({
      actor: actor.name,
      summary: `Document registered · ${created.filename}`,
      context: target ? `Linked to ${parseLink(target).label}` : 'Not linked to any record',
    });
    revalidate();
    return created;
  });
}

/**
 * Record a new version of an existing document (FR-04).
 *
 * Versions append — the original stays in the history. Like registration, this
 * records metadata only; no file is stored in this build.
 */
export async function addDocumentVersionAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('New version recorded · earlier versions retained', () => {
    const note = readString(form, 'note');
    const sizeMb = readAmount(form, 'sizeMb');

    const result = documentsService.addVersion({
      documentId: asId<'Document'>(requireString(form, 'documentId', 'Document')),
      ...(note !== undefined ? { note } : {}),
      ...(sizeMb !== undefined ? { sizeMb } : {}),
      actor: accessService.getCurrentUser().id,
    });
    revalidate();
    revalidatePath('/properties');
    return result;
  });
}

/** Hide a document. The record and every version stay — deletion never erases history. */
export async function removeDocumentAction(
  _previous: ActionResult<unknown>,
  form: FormData,
): Promise<ActionResult<unknown>> {
  return runAction('Document hidden · record and history retained', () => {
    const result = documentsService.remove(
      asId<'Document'>(requireString(form, 'documentId', 'Document')),
      accessService.getCurrentUser().id,
    );
    revalidate();
    return result;
  });
}
