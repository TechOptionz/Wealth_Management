/**
 * Empty the database so the next request seeds it afresh with sample data.
 *
 *   npm run db:reset
 *
 * Reads DATABASE_URL (or POSTGRES_URL) from the environment; `.env.local` is
 * loaded automatically when present. Both tables are dropped, so it also works
 * on a database the app has never touched.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('Set DATABASE_URL (or POSTGRES_URL) before running db:reset.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('DROP TABLE IF EXISTS holdfast_records; DROP TABLE IF EXISTS holdfast_collections;');
  console.log('Database emptied. The next request will seed it with sample data.');
} finally {
  await client.end();
}
