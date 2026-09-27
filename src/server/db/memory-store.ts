/**
 * The in-process store: one table per collection, seeded on first use.
 *
 * Used when no database is configured (local development, the test suite).
 * Cached on globalThis so a dev-mode hot reload does not silently reset every
 * collection to its seed.
 */
import { getCollectionDefinition, type HasId } from './registry';
import { RecordTable } from './record-table';
import type { CollectionStore } from './store';

class MemoryStore implements CollectionStore {
  private readonly tables = new Map<string, RecordTable>();

  private table(name: string): RecordTable {
    let table = this.tables.get(name);
    if (!table) {
      table = new RecordTable(name, getCollectionDefinition(name)?.seed() ?? []);
      this.tables.set(name, table);
    }
    return table;
  }

  list<T extends HasId>(name: string): readonly T[] {
    return this.table(name).list() as readonly T[];
  }

  find<T extends HasId>(name: string, id: string): T | undefined {
    return this.table(name).find(id) as T | undefined;
  }

  insert<T extends HasId>(name: string, record: T): T {
    return this.table(name).insert(record) as T;
  }

  update<T extends HasId>(name: string, id: string, changes: Partial<Omit<T, 'id'>>): T | undefined {
    return this.table(name).update(id, changes) as T | undefined;
  }

  remove(name: string, id: string): boolean {
    return this.table(name).remove(id);
  }

  reset(name: string): void {
    this.table(name).replaceAll(getCollectionDefinition(name)?.seed() ?? []);
  }

  size(name: string): number {
    return this.table(name).size;
  }
}

interface GlobalWithMemoryStore {
  __holdfastMemoryStore__?: CollectionStore;
}

export function memoryStore(): CollectionStore {
  const globalRef = globalThis as unknown as GlobalWithMemoryStore;
  globalRef.__holdfastMemoryStore__ ??= new MemoryStore();
  return globalRef.__holdfastMemoryStore__;
}
