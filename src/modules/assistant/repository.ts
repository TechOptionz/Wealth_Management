/**
 * Assistant request log — the only file in this module that touches storage.
 */
import { createCollection } from '@/server/db/collection';
import type { ProjectId, UserId } from '@/shared/types/common';
import type { AssistantRequest } from './model';

const requests = createCollection<AssistantRequest>('assistant.requests', () => []);

export const assistantRepository = {
  listFor: (projectId: ProjectId, userId: UserId): readonly AssistantRequest[] =>
    [...requests.where((request) => request.projectId === projectId && request.userId === userId)].sort((a, b) => a.at.localeCompare(b.at)),
  insert: (request: AssistantRequest): AssistantRequest => requests.insert(request),
  /** Test isolation. */
  reset: (): void => requests.reset(),
};
