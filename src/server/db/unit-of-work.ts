/**
 * Where a request's data comes from, and when its writes are saved.
 *
 * With the memory adapter there is nothing to do: reads and writes hit the
 * process-wide store directly.
 *
 * With Postgres, each request works on a `Snapshot` loaded once up front:
 *
 *   withUnitOfWork(work)  - route handlers and Server Actions. Loads a
 *                           snapshot, runs `work` with it as the active store,
 *                           then writes the journal in one transaction. If
 *                           `work` throws, nothing is written.
 *   loadUnitOfWork()      - pages and layouts. Loads a read-only snapshot,
 *                           shared by every component rendering that request.
 *
 * Route handlers and actions find their snapshot through AsyncLocalStorage;
 * renders find theirs through React's per-request `cache`, which is what lets
 * a layout and a page share one load.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import { databaseUrl, resolveAdapter, type DataAdapter } from './adapter';
import { memoryStore } from './memory-store';
import { listCollectionDefinitions } from './registry';
import { Snapshot } from './snapshot';
import type { RecordStorage } from './storage';
import type { CollectionStore } from './store';

const activeStore = new AsyncLocalStorage<CollectionStore>();

export interface RequestHolder {
  snapshot?: Snapshot;
  loading?: Promise<void>;
}

const requestHolder = cache((): RequestHolder => ({}));

interface GlobalWithStorage {
  __holdfastStorage__?: RecordStorage;
  __holdfastStorageOverride__?: RecordStorage;
}

const globalRef = globalThis as unknown as GlobalWithStorage;

/**
 * Point units of work at a different backend. Tests use it to substitute an
 * in-memory fake or a throwaway database; passing undefined restores the
 * configured adapter.
 */
export function overrideStorage(storage: RecordStorage | undefined): void {
  globalRef.__holdfastStorageOverride__ = storage;
}

function adapter(): DataAdapter {
  return globalRef.__holdfastStorageOverride__ ? 'postgres' : resolveAdapter();
}

async function storage(): Promise<RecordStorage> {
  if (globalRef.__holdfastStorageOverride__) return globalRef.__holdfastStorageOverride__;
  if (!globalRef.__holdfastStorage__) {
    const url = databaseUrl();
    if (!url) throw new Error('DATA_ADAPTER is "postgres" but DATABASE_URL is not set.');
    // Loaded on demand so the memory adapter never touches the driver.
    const { PostgresStorage } = await import('./postgres-storage');
    globalRef.__holdfastStorage__ = new PostgresStorage(url);
  }
  return globalRef.__holdfastStorage__;
}

let manifest: Promise<unknown> | undefined;

/**
 * Register every module's collections, so seeding covers all of them rather than
 * only the ones this request's code happened to import. Imported dynamically:
 * infrastructure must not load the modules layer at module-evaluation time.
 */
function registerAllCollections(): Promise<unknown> {
  manifest ??= import('@/modules/all-repositories');
  return manifest;
}

async function openSnapshot(readOnly: boolean): Promise<Snapshot> {
  await registerAllCollections();
  const backend = await storage();
  const { rows, seeded } = await backend.load();
  const snapshot = new Snapshot(rows, seeded, readOnly);
  // Seed any collection the database has not seen yet, so first use of an empty
  // database produces the same sample data the memory adapter starts with.
  for (const definition of listCollectionDefinitions()) snapshot.ensureLoaded(definition.name);
  return snapshot;
}

/** Run `work` against a snapshot and save its writes when it succeeds. */
export async function withUnitOfWork<T>(work: () => T | Promise<T>): Promise<T> {
  if (adapter() === 'memory') return work();
  // Already inside one: join it rather than open a nested, conflicting snapshot.
  if (activeStore.getStore()) return work();

  const snapshot = await openSnapshot(false);
  const result = await activeStore.run(snapshot, async () => work());
  await (await storage()).apply(snapshot.drainJournal());
  return result;
}

/**
 * Load the request's read-only snapshot before a page or layout reads data.
 * Concurrent callers in the same request share one load.
 */
export async function loadUnitOfWork(): Promise<void> {
  if (adapter() === 'memory') return;
  if (activeStore.getStore()) return;
  await hydrate(requestHolder());
}

/** The load behind `loadUnitOfWork`, separated so tests can drive it without React. */
export async function hydrate(holder: RequestHolder): Promise<void> {
  if (holder.snapshot) return;
  holder.loading ??= (async () => {
    const snapshot = await openSnapshot(true);
    // The only writes a read-only snapshot can hold are first-time seeds.
    const seeds = snapshot.drainJournal();
    if (seeds.length > 0) await (await storage()).apply(seeds);
    holder.snapshot = snapshot;
  })();
  await holder.loading;
}

/** Run `work` with an explicit store active. Tests use it with a hydrated holder. */
export function runWithStore<T>(store: CollectionStore, work: () => T): T {
  return activeStore.run(store, work);
}

/** The store backing the current execution. Collections call this on every access. */
export function currentStore(): CollectionStore {
  const active = activeStore.getStore();
  if (active) return active;
  if (adapter() === 'memory') return memoryStore();

  const snapshot = requestHolder().snapshot;
  if (snapshot) return snapshot;
  throw new Error(
    'No data is loaded for this request. Route handlers and Server Actions run inside ' +
      'withUnitOfWork(); a page or layout must `await loadUnitOfWork()` before reading.',
  );
}
