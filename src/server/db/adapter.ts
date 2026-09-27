/**
 * Which backend holds the data.
 *
 *   memory   - seeded in-process store; the default when no database is set
 *   postgres - chosen automatically when DATABASE_URL (or POSTGRES_URL) is set
 *
 * DATA_ADAPTER overrides the automatic choice, e.g. "memory" to run locally
 * against sample data while a DATABASE_URL is still in the environment.
 */
export type DataAdapter = 'memory' | 'postgres';

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

export function resolveAdapter(): DataAdapter {
  const configured = process.env.DATA_ADAPTER;
  if (configured === 'memory' || configured === 'postgres') return configured;
  if (configured) {
    throw new Error(`DATA_ADAPTER must be "memory" or "postgres", not "${configured}".`);
  }
  return databaseUrl() ? 'postgres' : 'memory';
}
