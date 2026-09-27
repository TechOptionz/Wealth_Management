/**
 * Access data access. The only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { UserId } from '@/shared/types/common';
import type { AccessGrant, AuditEvent, User } from './model';
import { seedAccessGrants, seedAuditEvents, seedContinuityPosture, seedUsers } from './data/seed';

const users = createCollection<User>('access.users', seedUsers);
const grants = createCollection<AccessGrant>('access.grants', seedAccessGrants);
const auditEvents = createCollection<AuditEvent>('access.audit', seedAuditEvents);

/**
 * The active test persona, stored as a single record so it survives restarts
 * and is shared by every server instance, the same as any other data.
 * Deployment-wide, not per-browser: a real session replaces this.
 */
interface ActiveSession {
  readonly id: 'active';
  readonly userId: UserId;
}
const ACTIVE_SESSION_ID = 'active';
const session = createCollection<ActiveSession>('access.session', () => []);

export const accessRepository = {
  getActiveUserId: (): UserId | undefined => session.find(ACTIVE_SESSION_ID)?.userId,
  setActiveUserId: (id: UserId): void => {
    if (session.find(ACTIVE_SESSION_ID)) {
      session.update(ACTIVE_SESSION_ID, { userId: id });
    } else {
      session.insert({ id: ACTIVE_SESSION_ID, userId: id });
    }
  },
  listUsers: (): readonly User[] => users.list(),
  findUser: (id: UserId): User | undefined => users.find(id),
  insertUser: (user: User): User => users.insert(user),
  listGrants: (): readonly AccessGrant[] => grants.list(),
  insertGrant: (grant: AccessGrant): AccessGrant => grants.insert(grant),
  findGrantForUser: (userId: UserId): AccessGrant | undefined => grants.findBy((grant) => grant.userId === userId),
  /** Audit events, newest first. */
  listAuditEvents: (): readonly AuditEvent[] => [...auditEvents.list()].sort((a, b) => b.at.localeCompare(a.at)),
  appendAuditEvent: (event: AuditEvent): AuditEvent => auditEvents.insert(event),
  getContinuityPosture: seedContinuityPosture,
};
