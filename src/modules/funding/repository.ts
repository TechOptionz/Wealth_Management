/**
 * Funding data access — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type {
  DebtFacilityId,
  EquityMovementId,
  EquityParticipantId,
  FacilityMovementId,
  ProjectId,
  WaterfallVersionId,
} from '@/shared/types/common';
import type { DebtFacility, EquityMovement, EquityParticipant, FacilityMovement, WaterfallVersion } from './model';
import {
  seedEquityMovements,
  seedEquityParticipants,
  seedFacilities,
  seedFacilityMovements,
  seedWaterfallVersions,
} from './data/seed';

const facilities = createCollection<DebtFacility>('funding.facilities', seedFacilities);
const facilityMovements = createCollection<FacilityMovement>('funding.facility-movements', seedFacilityMovements);
const participants = createCollection<EquityParticipant>('funding.participants', seedEquityParticipants);
const equityMovements = createCollection<EquityMovement>('funding.equity-movements', seedEquityMovements);
const waterfalls = createCollection<WaterfallVersion>('funding.waterfall-versions', seedWaterfallVersions);

const byDateThenCreated = <T extends { readonly on: string; readonly createdAt: string }>(a: T, b: T): number =>
  a.on.localeCompare(b.on) || a.createdAt.localeCompare(b.createdAt);

export const fundingRepository = {
  /** Facilities of a project in draw rank, ties by id so the order is stable. */
  listFacilities: (projectId: ProjectId): readonly DebtFacility[] =>
    [...facilities.where((row) => row.projectId === projectId)].sort((a, b) => a.drawRank - b.drawRank || a.id.localeCompare(b.id)),
  findFacility: (id: DebtFacilityId): DebtFacility | undefined => facilities.find(id),
  insertFacility: (row: DebtFacility): DebtFacility => facilities.insert(row),
  updateFacility: (id: DebtFacilityId, changes: Partial<Omit<DebtFacility, 'id'>>): DebtFacility | undefined =>
    facilities.update(id, changes),

  /** Movements of a facility, oldest first. */
  listMovements: (facilityId: DebtFacilityId): readonly FacilityMovement[] =>
    [...facilityMovements.where((row) => row.facilityId === facilityId)].sort(byDateThenCreated),
  listProjectMovements: (projectId: ProjectId): readonly FacilityMovement[] =>
    [...facilityMovements.where((row) => row.projectId === projectId)].sort(byDateThenCreated),
  findMovement: (id: FacilityMovementId): FacilityMovement | undefined => facilityMovements.find(id),
  insertMovement: (row: FacilityMovement): FacilityMovement => facilityMovements.insert(row),

  /** Participants of a project in seeded/creation order. */
  listParticipants: (projectId: ProjectId): readonly EquityParticipant[] =>
    participants.where((row) => row.projectId === projectId),
  findParticipant: (id: EquityParticipantId): EquityParticipant | undefined => participants.find(id),
  insertParticipant: (row: EquityParticipant): EquityParticipant => participants.insert(row),

  listEquityMovements: (projectId: ProjectId): readonly EquityMovement[] =>
    [...equityMovements.where((row) => row.projectId === projectId)].sort(byDateThenCreated),
  listMovementsForParticipant: (participantId: EquityParticipantId): readonly EquityMovement[] =>
    [...equityMovements.where((row) => row.participantId === participantId)].sort(byDateThenCreated),
  findEquityMovement: (id: EquityMovementId): EquityMovement | undefined => equityMovements.find(id),
  insertEquityMovement: (row: EquityMovement): EquityMovement => equityMovements.insert(row),

  /** Waterfall versions of a project, oldest version first. */
  listWaterfalls: (projectId: ProjectId): readonly WaterfallVersion[] =>
    [...waterfalls.where((row) => row.projectId === projectId)].sort((a, b) => a.version - b.version),
  findWaterfall: (id: WaterfallVersionId): WaterfallVersion | undefined => waterfalls.find(id),
  insertWaterfall: (row: WaterfallVersion): WaterfallVersion => waterfalls.insert(row),
  updateWaterfall: (id: WaterfallVersionId, changes: Partial<Omit<WaterfallVersion, 'id'>>): WaterfallVersion | undefined =>
    waterfalls.update(id, changes),

  /** Test isolation. */
  reset: (): void => {
    facilities.reset();
    facilityMovements.reset();
    participants.reset();
    equityMovements.reset();
    waterfalls.reset();
  },
};
