'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readString, requireString } from '@/shared/lib/form-data';
import { assistantApi } from './api';

/** AI01 — ask a read-only question about the project. */
export async function askAssistantAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Answered', () => {
    const projectId = requireString(form, 'projectId', 'Project');
    const request = assistantApi.ask(projectId, readString(form, 'question') ?? '');
    revalidatePath(`/projects/${projectId}/assistant`);
    return request;
  });
}
