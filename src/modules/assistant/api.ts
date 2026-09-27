/**
 * Transport-agnostic handlers for the Assistant. The project scope is taken
 * from the guard for the signed-in user; the request body carries only the
 * question, never a project permission (AI03).
 */
import { resolveAsOfDate } from '@/shared/config/app-config';
import { ValidationError } from '@/shared/lib/errors';
import { asId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { assistantService } from './service';
import type { AssistantRequest } from './model';

export const assistantApi = {
  history(rawProjectId: string): readonly AssistantRequest[] {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'assistant.use');
    return assistantService.history(projectId, scope.userId);
  },

  ask(rawProjectId: string, question: string): AssistantRequest {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(rawProjectId);
    const scope = projectsService.guard(projectId, 'assistant.use');
    if (!question.trim()) throw new ValidationError('Ask a question.', { fieldErrors: { question: ['Type a question about this project.'] } });
    return assistantService.ask({ projectId, scope, question, asOf: resolveAsOfDate() });
  },
};
