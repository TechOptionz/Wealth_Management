/**
 * Postgres as the durable store.
 *
 * Records keep their in-memory shape: one row per record, the record itself as
 * JSONB, with a sequence column preserving insertion order. This makes the
 * database a faithful mirror of the collections rather than a second schema to
 * keep in step with `model.ts`. Reporting queries, when they arrive, can index
 * into the JSONB or project it into typed tables.
 *
 * The schema is created on first use. Both statements are idempotent, so
 * several instances starting at once do not race.
 */
import { Pool, type PoolConfig } from 'pg';
import type { JournalOp, LoadedData, RecordStorage, StoredRow } from './storage';

export const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS holdfast_records (
    collection text NOT NULL,
    id text NOT NULL,
    position bigserial NOT NULL,
    data jsonb NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS holdfast_collections (
    name text PRIMARY KEY,
    seeded_at timestamptz NOT NULL DEFAULT now()
  );
`;

const LOAD = `
  SELECT
    coalesce(
      (SELECT json_agg(json_build_object('collection', collection, 'id', id, 'data', data) ORDER BY position)
         FROM holdfast_records),
      '[]'::json
    ) AS rows,
    coalesce((SELECT json_agg(name ORDER BY name) FROM holdfast_collections), '[]'::json) AS seeded
`;

const INSERT = `INSERT INTO holdfast_records (collection, id, data) VALUES ($1, $2, $3::jsonb)`;
const UPSERT = `${INSERT} ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`;
const REMOVE = `DELETE FROM holdfast_records WHERE collection = $1 AND id = $2`;
const CLEAR = `DELETE FROM holdfast_records WHERE collection = $1`;
const SEED = `
  INSERT INTO holdfast_records (collection, id, data)
  SELECT $1, record->>'id', record FROM jsonb_array_elements($2::jsonb) AS record
  ON CONFLICT (collection, id) DO NOTHING
`;
const MARK_SEEDED = `INSERT INTO holdfast_collections (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`;

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

async function applyOp(client: Queryable, op: JournalOp): Promise<void> {
  switch (op.kind) {
    case 'insert':
      await client.query(INSERT, [op.collection, op.id, JSON.stringify(op.data)]);
      return;
    case 'update':
      await client.query(UPSERT, [op.collection, op.id, JSON.stringify(op.data)]);
      return;
    case 'remove':
      await client.query(REMOVE, [op.collection, op.id]);
      return;
    case 'seed':
      await client.query(SEED, [op.collection, JSON.stringify(op.records)]);
      await client.query(MARK_SEEDED, [op.collection]);
      return;
    case 'reset':
      await client.query(CLEAR, [op.collection]);
      await client.query(SEED, [op.collection, JSON.stringify(op.records)]);
      await client.query(MARK_SEEDED, [op.collection]);
      return;
  }
}

/**
 * TLS for the connection.
 *
 * A URL that names an `sslmode` is honoured as the driver interprets it. Otherwise a
 * local host connects in the clear and any other host is encrypted. The server's
 * certificate is checked against DATABASE_CA_CERT when that is set (the PEM a
 * provider such as Supabase publishes) and accepted unverified when it is not,
 * which is what hosted providers need when no CA bundle has been supplied.
 */
export function sslOptionsFor(connectionString: string, caCert = process.env.DATABASE_CA_CERT): PoolConfig['ssl'] {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return undefined;
  }
  if (url.searchParams.has('sslmode')) return undefined;
  if (['localhost', '127.0.0.1', '[::1]', ''].includes(url.hostname)) return false;
  return caCert ? { ca: caCert, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export class PostgresStorage implements RecordStorage {
  private readonly pool: Pool;
  private ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    // Serverless functions are short-lived and many; keep each one's pool small.
    this.pool = new Pool({ connectionString, ssl: sslOptionsFor(connectionString), max: 4, idleTimeoutMillis: 30_000 });
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.pool.query(POSTGRES_SCHEMA).then(() => undefined);
    return this.ready;
  }

  async load(): Promise<LoadedData> {
    await this.ensureReady();
    const result = await this.pool.query<{ rows: StoredRow[]; seeded: string[] }>(LOAD);
    const loaded = result.rows[0];
    return { rows: loaded?.rows ?? [], seeded: loaded?.seeded ?? [] };
  }

  async apply(ops: readonly JournalOp[]): Promise<void> {
    if (ops.length === 0) return;
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const op of ops) await applyOp(client, op);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Release every connection. Used by tests and scripts; a server never calls it. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
