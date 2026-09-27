/**
 * A unit of work's view of the data: every collection loaded once from
 * storage, read synchronously, with each write journalled for replay when the
 * unit of work ends.
 *
 * Reads inside one request therefore see one consistent state, plus that
 * request's own writes. Two requests running at the same time do not see each
 * other's writes until they finish; the last write to a record wins.
 *
 * A collection that storage has never seeded is seeded here from its
 * definition, and the seed is journalled, so a fresh database fills itself on
 * first use without a separate setup step.
 */
import { getCollectionDefinition, type HasId } from './registry';
import { RecordTable } from './record-table';
import type { CollectionStore } from './store';
import type { JournalOp, StoredRow } from './storage';

export class Snapshot implements CollectionStore {
  private readonly tables = new Map<string, RecordTable>();
  private readonly seeded: Set<string>;
  private journal: JournalOp[] = [];

  constructor(
    rows: readonly StoredRow[],
    seeded: Iterable<string>,
    /** A page render loads read-only: it has no point at which to flush a write. */
    private readonly readOnly: boolean,
  ) {
    this.seeded = new Set(seeded);
    const grouped = new Map<string, HasId[]>();
    for (const row of rows) {
      const records = grouped.get(row.collection) ?? [];
      records.push(row.data);
      grouped.set(row.collection, records);
    }
    for (const [name, records] of grouped) {
      this.tables.set(name, new RecordTable(name, records));
    }
  }

  /** Make sure a collection is present, seeding it if storage never has. */
  ensureLoaded(name: string): void {
    this.table(name);
  }

  /** Hand over the journal and start a new one. */
  drainJournal(): readonly JournalOp[] {
    const ops = this.journal;
    this.journal = [];
    return ops;
  }

  private table(name: string): RecordTable {
    let table = this.tables.get(name);
    if (!table) {
      const records = this.seeded.has(name) ? [] : (getCollectionDefinition(name)?.seed() ?? []);
      table = new RecordTable(name, records);
      this.tables.set(name, table);
      if (!this.seeded.has(name)) {
        this.seeded.add(name);
        this.journal.push({ kind: 'seed', collection: name, records });
      }
    }
    return table;
  }

  private assertWritable(name: string): void {
    if (this.readOnly) {
      throw new Error(
        `${name}: this request loaded data read-only (a page render). ` +
          'Writes belong in a Server Action or route handler, which run inside withUnitOfWork().',
      );
    }
  }

  list<T extends HasId>(name: string): readonly T[] {
    return this.table(name).list() as readonly T[];
  }

  find<T extends HasId>(name: string, id: string): T | undefined {
    return this.table(name).find(id) as T | undefined;
  }

  insert<T extends HasId>(name: string, record: T): T {
    this.assertWritable(name);
    const stored = this.table(name).insert(record);
    this.journal.push({ kind: 'insert', collection: name, id: stored.id, data: stored });
    return stored as T;
  }

  update<T extends HasId>(name: string, id: string, changes: Partial<Omit<T, 'id'>>): T | undefined {
    this.assertWritable(name);
    const stored = this.table(name).update(id, changes);
    if (stored) this.journal.push({ kind: 'update', collection: name, id, data: stored });
    return stored as T | undefined;
  }

  remove(name: string, id: string): boolean {
    this.assertWritable(name);
    const removed = this.table(name).remove(id);
    if (removed) this.journal.push({ kind: 'remove', collection: name, id });
    return removed;
  }

  reset(name: string): void {
    this.assertWritable(name);
    const records = getCollectionDefinition(name)?.seed() ?? [];
    this.table(name).replaceAll(records);
    this.seeded.add(name);
    this.journal.push({ kind: 'reset', collection: name, records });
  }

  size(name: string): number {
    return this.table(name).size;
  }
}
