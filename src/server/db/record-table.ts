/**
 * One collection's records, in insertion order.
 *
 * Shared by the memory store and the Postgres snapshot so both enforce the same
 * rules: ids are unique, records are frozen on the way in, and an update
 * shallow-merges rather than replaces.
 */
import type { HasId } from './registry';

export class RecordTable {
  readonly name: string;
  private records = new Map<string, HasId>();

  constructor(name: string, initial: readonly HasId[] = []) {
    this.name = name;
    this.replaceAll(initial);
  }

  list(): readonly HasId[] {
    return [...this.records.values()];
  }

  find(id: string): HasId | undefined {
    return this.records.get(id);
  }

  insert(record: HasId): HasId {
    if (this.records.has(record.id)) {
      throw new Error(`${this.name}: a record with id "${record.id}" already exists.`);
    }
    const stored = Object.freeze({ ...record });
    this.records.set(record.id, stored);
    return stored;
  }

  update(id: string, changes: object): HasId | undefined {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    const stored = Object.freeze({ ...existing, ...changes, id: existing.id });
    this.records.set(id, stored);
    return stored;
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  replaceAll(records: readonly HasId[]): void {
    this.records = new Map(records.map((record) => [record.id, Object.freeze({ ...record })]));
  }

  get size(): number {
    return this.records.size;
  }
}
