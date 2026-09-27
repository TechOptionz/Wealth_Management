import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import { PolicyRequiredError } from '@/shared/lib/errors';

/** POST /api/v1/webhooks/{provider} — no provider is connected, so notifications are refused (INT04 deferred). */
export function POST(request: NextRequest) {
  return handleV1(request, () => {
    throw new PolicyRequiredError('accounting-connection', 'No accounting provider is connected, so webhooks are not accepted.');
  });
}
