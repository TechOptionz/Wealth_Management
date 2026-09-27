import type { NextRequest } from 'next/server';
import { handleV1, parseV1Query } from '@/server/http/v1';
import { projectsApi } from '@/modules/projects/api';
import { createProjectSchema, projectListQuerySchema } from '@/modules/projects/validation';

/** GET /api/v1/projects — projects the caller may open (IAM01). */
export function GET(request: NextRequest) {
  return handleV1(request, () => projectsApi.list(parseV1Query(request, projectListQuerySchema)));
}

/** POST /api/v1/projects — create a project draft (PRJ01). Idempotency-Key required. */
export function POST(request: NextRequest) {
  return handleV1(request, ({ body }) => projectsApi.create(body), { schema: createProjectSchema, status: 201, idempotent: true });
}
