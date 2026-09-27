/**
 * The unit of work behind the Postgres adapter: one snapshot per request,
 * writes journalled and saved together, sample data seeded on first use.
 *
 * Runs against an in-memory fake of the storage contract so the semantics are
 * pinned without a database. `db-postgres.integration.test.ts` covers the SQL.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCollection } from '@/server/db/collection';
import type { HasId } from '@/server/db/registry';
import type { JournalOp, LoadedData, RecordStorage, StoredRow } from '@/server/db/storage';
import {
  hydrate,
  overrideStorage,
  runWithStore,
  withUnitOfWork,
  type RequestHolder,
} from '@/server/db/unit-of-work';

interface Thing extends HasId {
  readonly label: string;
  readonly count: number;
}

class FakeStorage implements RecordStorage {
  readonly tables = new Map<string, Map<string, HasId>>();
  readonly seeded = new Set<string>();
  readonly batches: JournalOp[][] = [];
  loads = 0;

  async load(): Promise<LoadedData> {
    this.loads += 1;
    const rows: StoredRow[] = [];
    for (const [collection, records] of this.tables) {
      for (const data of records.values()) rows.push({ collection, id: data.id, data });
    }
    return { rows, seeded: [...this.seeded] };
  }

  async apply(ops: readonly JournalOp[]): Promise<void> {
    this.batches.push([...ops]);
    for (const op of ops) {
      const table = this.tables.get(op.collection) ?? new Map<string, HasId>();
      this.tables.set(op.collection, table);
      switch (op.kind) {
        case 'insert':
          if (table.has(op.id)) throw new Error(`duplicate ${op.id}`);
          table.set(op.id, op.data);
          break;
        case 'update':
          table.set(op.id, op.data);
          break;
        case 'remove':
          table.delete(op.id);
          break;
        case 'seed':
          for (const record of op.records) if (!table.has(record.id)) table.set(record.id, record);
          this.seeded.add(op.collection);
          break;
        case 'reset':
          table.clear();
          for (const record of op.records) table.set(record.id, record);
          this.seeded.add(op.collection);
          break;
      }
    }
  }

  ids(collection: string): readonly string[] {
    return [...(this.tables.get(collection)?.keys() ?? [])];
  }
}

const things = createCollection<Thing>('test.things', () => [
  { id: 't-1', label: 'one', count: 1 },
  { id: 't-2', label: 'two', count: 2 },
]);

function snapshotOf(holder: RequestHolder) {
  if (!holder.snapshot) throw new Error('not hydrated');
  return holder.snapshot;
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  overrideStorage(storage);
});

afterEach(() => overrideStorage(undefined));

describe('memory adapter', () => {
  it('reads and writes the process-wide store with no unit of work', async () => {
    overrideStorage(undefined);
    expect(things.list().map((t) => t.id)).toEqual(['t-1', 't-2']);
    expect(await withUnitOfWork(() => things.size)).toBe(2);
    expect(storage.loads).toBe(0);
  });
});

describe('postgres adapter · unit of work', () => {
  it('refuses reads outside a unit of work', () => {
    expect(() => things.list()).toThrow(/loadUnitOfWork/);
  });

  it('seeds an empty database on first use and saves the seed', async () => {
    const ids = await withUnitOfWork(() => things.list().map((t) => t.id));
    expect(ids).toEqual(['t-1', 't-2']);
    expect(storage.seeded.has('test.things')).toBe(true);
    expect(storage.ids('test.things')).toEqual(['t-1', 't-2']);
  });

  it('does not reseed a collection that was seeded and later emptied', async () => {
    await withUnitOfWork(() => {
      things.remove('t-1');
      things.remove('t-2');
    });
    expect(await withUnitOfWork(() => things.size)).toBe(0);
  });

  it('saves writes in order when the work succeeds, and later units see them', async () => {
    await withUnitOfWork(() => {
      things.insert({ id: 't-3', label: 'three', count: 3 });
      things.update('t-1', { count: 10 });
      things.remove('t-2');
    });
    const kinds = storage.batches.at(-1)?.map((op) => op.kind) ?? [];
    // Every registered collection is seeded first; the request's own writes follow in order.
    expect(kinds.filter((kind) => kind !== 'seed')).toEqual(['insert', 'update', 'remove']);
    expect(kinds.indexOf('insert')).toBeGreaterThan(kinds.lastIndexOf('seed'));
    const seen = await withUnitOfWork(() => things.list().map((t) => `${t.id}:${t.count}`));
    expect(seen).toEqual(['t-1:10', 't-3:3']);
  });

  it('saves nothing when the work throws', async () => {
    await withUnitOfWork(() => things.size);
    const batches = storage.batches.length;
    await expect(
      withUnitOfWork(() => {
        things.insert({ id: 't-9', label: 'nine', count: 9 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(storage.batches.length).toBe(batches);
    expect(storage.ids('test.things')).toEqual(['t-1', 't-2']);
  });

  it('gives each unit of work its own snapshot: a request reads its own writes, others do not', async () => {
    await withUnitOfWork(() => things.size);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = withUnitOfWork(async () => {
      things.insert({ id: 't-slow', label: 'slow', count: 0 });
      const seesOwnWrite = things.find('t-slow') !== undefined;
      await gate;
      return seesOwnWrite;
    });
    const other = await withUnitOfWork(() => things.find('t-slow') === undefined);
    release();
    expect(await slow).toBe(true);
    expect(other).toBe(true);
    expect(await withUnitOfWork(() => things.find('t-slow')?.label)).toBe('slow');
  });

  it('joins an enclosing unit of work instead of opening a second snapshot', async () => {
    await withUnitOfWork(async () => {
      things.insert({ id: 't-n', label: 'nested', count: 0 });
      const loads = storage.loads;
      expect(await withUnitOfWork(() => things.find('t-n')?.label)).toBe('nested');
      expect(storage.loads).toBe(loads);
    });
  });

  it('reset restores the seed as one operation', async () => {
    await withUnitOfWork(() => things.insert({ id: 't-3', label: 'three', count: 3 }));
    await withUnitOfWork(() => things.reset());
    expect(storage.batches.at(-1)?.map((op) => op.kind)).toEqual(['reset']);
    expect(storage.ids('test.things')).toEqual(['t-1', 't-2']);
  });
});

describe('postgres adapter · page render', () => {
  it('loads once per request, shares the snapshot, and seeds an empty database', async () => {
    const holder: RequestHolder = {};
    await Promise.all([hydrate(holder), hydrate(holder)]);
    expect(storage.loads).toBe(1);
    expect(storage.seeded.has('test.things')).toBe(true);
    const ids = runWithStore(snapshotOf(holder), () => things.list().map((t) => t.id));
    expect(ids).toEqual(['t-1', 't-2']);
  });

  it('refuses writes during a render', async () => {
    const holder: RequestHolder = {};
    await hydrate(holder);
    expect(() =>
      runWithStore(snapshotOf(holder), () => things.insert({ id: 'x', label: 'x', count: 0 })),
    ).toThrow(/read-only/);
  });
});
