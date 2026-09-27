import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import { PolicyRequiredError } from '@/shared/lib/errors';

/**
 * POST /api/v1/assistant-proposals/{id}/commit — Assistant change proposals are
 * Release 3 (AI05). The route makes the contract visible and always refuses:
 * nothing the Assistant produces can change a record in this build.
 */
export function POST(request: NextRequest) {
  return handleV1(request, () => {
    throw new PolicyRequiredError('assistant-proposals', 'Assistant change proposals are not available in this release (AI05, Release 3).');
  });
}
