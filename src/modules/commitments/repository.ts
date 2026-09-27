/**
 * Commitments data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { CommitmentId, ProjectId, SupplierId, VariationId } from '@/shared/types/common';
import type { Commitment, Supplier, Variation } from './model';
import { seedCommitments, seedSuppliers, seedVariations } from './data/seed';

const suppliers = createCollection<Supplier>('commitments.suppliers', seedSuppliers);
const commitments = createCollection<Commitment>('commitments.commitments', seedCommitments);
const variations = createCollection<Variation>('commitments.variations', seedVariations);

export const commitmentsRepository = {
  listSuppliers: (projectId: ProjectId): readonly Supplier[] => suppliers.where((row) => row.projectId === projectId),
  findSupplier: (id: SupplierId): Supplier | undefined => suppliers.find(id),
  insertSupplier: (row: Supplier): Supplier => suppliers.insert(row),
  updateSupplier: (id: SupplierId, changes: Partial<Omit<Supplier, 'id'>>): Supplier | undefined => suppliers.update(id, changes),

  listCommitments: (projectId: ProjectId): readonly Commitment[] => commitments.where((row) => row.projectId === projectId),
  findCommitment: (id: CommitmentId): Commitment | undefined => commitments.find(id),
  findCommitmentByReference: (projectId: ProjectId, reference: string): Commitment | undefined =>
    commitments.findBy((row) => row.projectId === projectId && row.reference.toLowerCase() === reference.toLowerCase()),
  insertCommitment: (row: Commitment): Commitment => commitments.insert(row),
  updateCommitment: (id: CommitmentId, changes: Partial<Omit<Commitment, 'id'>>): Commitment | undefined =>
    commitments.update(id, changes),

  listVariations: (commitmentId: CommitmentId): readonly Variation[] => variations.where((row) => row.commitmentId === commitmentId),
  listProjectVariations: (projectId: ProjectId): readonly Variation[] => variations.where((row) => row.projectId === projectId),
  findVariation: (id: VariationId): Variation | undefined => variations.find(id),
  insertVariation: (row: Variation): Variation => variations.insert(row),
  updateVariation: (id: VariationId, changes: Partial<Omit<Variation, 'id'>>): Variation | undefined => variations.update(id, changes),

  /** Test isolation. */
  reset: (): void => {
    suppliers.reset();
    commitments.reset();
    variations.reset();
  },
};
