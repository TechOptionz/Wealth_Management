/**
 * What a durable backend must provide to a unit of work: load everything, and
 * apply a journal of changes atomically. `postgres-storage.ts` implements it
 * for Postgres; tests use an in-memory fake.
 */
import type { HasId } from './registry';

export interface StoredRow {
  readonly collection: string;
  readonly id: string;
  readonly data: HasId;
}

/**
 * One change recorded by a snapshot, replayed in order when the unit of work
 * ends. `seed` and `reset` carry whole seed sets and are idempotent, so two
 * cold instances seeding the same empty database cannot conflict.
 */
export type JournalOp =
  | { readonly kind: 'insert'; readonly collection: string; readonly id: string; readonly data: HasId }
  | { readonly kind: 'update'; readonly collection: string; readonly id: string; readonly data: HasId }
  | { readonly kind: 'remove'; readonly collection: string; readonly id: string }
  | { readonly kind: 'seed'; readonly collection: string; readonly records: readonly HasId[] }
  | { readonly kind: 'reset'; readonly collection: string; readonly records: readonly HasId[] };

export interface LoadedData {
  /** Every stored row, in insertion order. */
  readonly rows: readonly StoredRow[];
  /** Collections that have been seeded at least once, even if now empty. */
  readonly seeded: readonly string[];
}

export interface RecordStorage {
  load(): Promise<LoadedData>;
  /** Apply the journal in order, all or nothing. */
  apply(ops: readonly JournalOp[]): Promise<void>;
}
