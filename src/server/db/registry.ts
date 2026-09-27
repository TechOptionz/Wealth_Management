/**
 * The collections the application has declared, with the seed that gives each
 * its starting records.
 *
 * Every backend (memory store, Postgres snapshot) reads this registry to seed a
 * collection the first time it is used. It is cached on globalThis so a
 * dev-mode hot reload keeps the registrations already made.
 */

export interface HasId {
  readonly id: string;
}

export interface CollectionDefinition {
  readonly name: string;
  readonly seed: () => readonly HasId[];
}

interface GlobalWithRegistry {
  __holdfastCollectionDefinitions__?: Map<string, CollectionDefinition>;
}

function registry(): Map<string, CollectionDefinition> {
  const globalRef = globalThis as unknown as GlobalWithRegistry;
  globalRef.__holdfastCollectionDefinitions__ ??= new Map();
  return globalRef.__holdfastCollectionDefinitions__;
}

export function registerCollection(definition: CollectionDefinition): void {
  registry().set(definition.name, definition);
}

export function getCollectionDefinition(name: string): CollectionDefinition | undefined {
  return registry().get(name);
}

export function listCollectionDefinitions(): readonly CollectionDefinition[] {
  return [...registry().values()];
}
