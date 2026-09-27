/**
 * The contract a backend fulfils for named collections.
 *
 * `Collection` handles (see `collection.ts`) delegate every call to whichever
 * store backs the current execution: the process-wide memory store, or the
 * per-request snapshot a unit of work loaded from Postgres.
 */
import type { HasId } from './registry';

export interface CollectionStore {
  list<T extends HasId>(name: string): readonly T[];
  find<T extends HasId>(name: string, id: string): T | undefined;
  insert<T extends HasId>(name: string, record: T): T;
  update<T extends HasId>(name: string, id: string, changes: Partial<Omit<T, 'id'>>): T | undefined;
  remove(name: string, id: string): boolean;
  /** Restore a collection to its seeded state. */
  reset(name: string): void;
  size(name: string): number;
}
