/**
 * Idempotency-Key storage for the versioned API (API03).
 *
 * A create, approve, publish or import request may carry an `Idempotency-Key`.
 * The key, a hash of the request and the outcome are stored; an identical
 * retry returns the stored result, and the same key with a different body is
 * refused. Application-level deduplication persists with the data, so it
 * outlives any provider's idempotency window (INT05).
 */
import { createHash } from 'node:crypto';
import { createCollection } from '@/server/db/collection';
import type { IsoDateTime } from '@/shared/types/common';

export interface IdempotencyRecord {
  /** The key itself, scoped by user so two people cannot collide. */
  readonly id: string;
  readonly requestHash: string;
  readonly status: number;
  readonly responseJson: string;
  readonly createdAt: IsoDateTime;
}

const records = createCollection<IdempotencyRecord>('server.idempotency', () => []);

export function hashRequest(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export const idempotencyStore = {
  find: (id: string): IdempotencyRecord | undefined => records.find(id),
  save: (record: IdempotencyRecord): IdempotencyRecord => records.insert(record),
  /** Test isolation. */
  reset: (): void => records.reset(),
};
