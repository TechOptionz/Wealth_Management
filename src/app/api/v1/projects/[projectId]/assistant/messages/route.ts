import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleV1 } from '@/server/http/v1';
import type { RouteContext } from '@/server/http/route';
import { assistantApi } from '@/modules/assistant/api';

const askSchema = z.object({ question: z.string().min(1).max(1000) });

/** GET — the caller's own question history on this project. */
export async function GET(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, () => assistantApi.history(projectId));
}

/** POST /api/v1/projects/{id}/assistant/messages — ask a read-only question (AI01–AI03). */
export async function POST(request: NextRequest, context: RouteContext<{ projectId: string }>) {
  const { projectId } = await context.params;
  return handleV1(request, ({ body }) => assistantApi.ask(projectId, body.question), { schema: askSchema });
}
