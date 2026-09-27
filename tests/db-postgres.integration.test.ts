/**
 * The Postgres backend against a real database.
 *
 * Skipped unless TEST_DATABASE_URL is set, for example:
 *
 *   TEST_DATABASE_URL=postgres://postgres:holdfast@localhost:55432/postgres npm test
 *
 * Both tables are dropped at the start, so point it at a throwaway database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createCollection } from '@/server/db/collection';
import { PostgresStorage } from '@/server/db/postgres-storage';
import { overrideStorage, withUnitOfWork } from '@/server/db/unit-of-work';
import { money } from '@/shared/lib/money';

const url = process.env.TEST_DATABASE_URL ?? '';

describe.skipIf(url === '')('PostgresStorage', () => {
  let storage: PostgresStorage;

  beforeAll(async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query('DROP TABLE IF EXISTS holdfast_records; DROP TABLE IF EXISTS holdfast_collections;');
    await client.end();
    storage = new PostgresStorage(url);
  });

  afterAll(async () => {
    overrideStorage(undefined);
    await storage.close();
  });

  it('creates its schema and starts empty', async () => {
    const loaded = await storage.load();
    expect(loaded.rows).toEqual([]);
    expect(loaded.seeded).toEqual([]);
  });

  it('applies a journal in order, keeping insertion order and the JSON shape of a record', async () => {
    const a = { id: 'a', amount: money(150), tags: ['x', 'y'], nested: { flag: true, none: null } };
    const updated = { ...a, tags: [] as string[] };
    await storage.apply([
      { kind: 'seed', collection: 'it.things', records: [{ id: 'z' }, a] },
      { kind: 'insert', collection: 'it.things', id: 'b', data: { id: 'b' } },
      { kind: 'update', collection: 'it.things', id: 'a', data: updated },
      { kind: 'remove', collection: 'it.things', id: 'z' },
    ]);

    const loaded = await storage.load();
    expect(loaded.seeded).toEqual(['it.things']);
    expect(loaded.rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(loaded.rows[0]?.data).toEqual(updated);
  });

  it('rolls the whole journal back when one operation fails', async () => {
    await expect(
      storage.apply([
        { kind: 'insert', collection: 'it.things', id: 'c', data: { id: 'c' } },
        // Duplicate of an existing id: the transaction must fail as a whole.
        { kind: 'insert', collection: 'it.things', id: 'b', data: { id: 'b' } },
      ]),
    ).rejects.toThrow();

    const loaded = await storage.load();
    expect(loaded.rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('seeds without overwriting existing records, and reset replaces them', async () => {
    const fresh = { id: 'a', fresh: true };
    await storage.apply([{ kind: 'seed', collection: 'it.things', records: [fresh] }]);
    let loaded = await storage.load();
    expect(loaded.rows.find((row) => row.id === 'a')?.data).not.toHaveProperty('fresh');

    await storage.apply([{ kind: 'reset', collection: 'it.things', records: [{ id: 'r1' }, { id: 'r2' }] }]);
    loaded = await storage.load();
    expect(loaded.rows.map((row) => row.id)).toEqual(['r1', 'r2']);
  });

  it('serves a unit of work end to end', async () => {
    overrideStorage(storage);
    const things = createCollection<{ readonly id: string; readonly n: number }>('it.uow', () => [
      { id: 'seed-1', n: 1 },
    ]);

    await withUnitOfWork(() => {
      things.insert({ id: 'new-1', n: 2 });
      things.update('seed-1', { n: 5 });
    });

    const seen = await withUnitOfWork(() => things.list().map((t) => `${t.id}:${t.n}`));
    expect(seen).toEqual(['seed-1:5', 'new-1:2']);
  });
});
