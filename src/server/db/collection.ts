/**
 * Collection: the single data-access seam.
 *
 * Every module repository is built on `createCollection`. A collection is a
 * handle: each call resolves the store backing the current execution and
 * delegates to it. Which store that is depends on the data adapter:
 *
 *   memory   - one process-wide store, seeded on first use (dev, tests)
 *   postgres - a per-request snapshot loaded from Postgres by `withUnitOfWork`
 *              (route handlers, Server Actions) or `loadUnitOfWork` (pages);
 *              writes are journalled and saved when the unit of work ends
 *
 * The interface is deliberately synchronous. Services compose reads freely
 * inside `.map` and `.filter` chains and never await; the asynchronous part of
 * persistence (loading the snapshot, saving the journal) happens once per
 * request at the boundary, not on every read. See `unit-of-work.ts`.
 *
 * Records are frozen on the way in and never mutated in place, so callers
 * cannot corrupt stored state by accident, the same guarantee a real database
 * gives.
 */
import { registerCollection, type HasId } from './registry';
import { currentStore } from './unit-of-work';

export type { HasId };

export interface Collection<T extends HasId> {
  /** All records, in insertion order. */
  list(): readonly T[];
  /** Records matching a predicate. */
  where(predicate: (record: T) => boolean): readonly T[];
  /** A single record, or undefined when absent. */
  find(id: string): T | undefined;
  /** First record matching a predicate. */
  findBy(predicate: (record: T) => boolean): T | undefined;
  insert(record: T): T;
  /** Shallow-merges `changes`; returns undefined when the id is unknown. */
  update(id: string, changes: Partial<Omit<T, 'id'>>): T | undefined;
  remove(id: string): boolean;
  /** Restore the collection to its seeded state. Used by tests. */
  reset(): void;
  readonly size: number;
}

export function createCollection<T extends HasId>(name: string, seed: () => readonly T[]): Collection<T> {
  registerCollection({ name, seed });

  return {
    list: () => currentStore().list<T>(name),
    where: (predicate) => currentStore().list<T>(name).filter(predicate),
    find: (id) => currentStore().find<T>(name, id),
    findBy: (predicate) => currentStore().list<T>(name).find(predicate),
    insert: (record) => currentStore().insert(name, record),
    update: (id, changes) => currentStore().update<T>(name, id, changes),
    remove: (id) => currentStore().remove(name, id),
    reset: () => currentStore().reset(name),
    get size() {
      return currentStore().size(name);
    },
  };
}
