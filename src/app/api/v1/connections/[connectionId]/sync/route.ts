import type { NextRequest } from 'next/server';
import { handleV1 } from '@/server/http/v1';
import { PolicyRequiredError } from '@/shared/lib/errors';

/**
 * POST /api/v1/connections/{id}/sync — accounting integrations (Xero, MYOB)
 * are deferred. The route refuses clearly rather than pretending a connection
 * exists (§2.2, §16.1).
 */
export function POST(request: NextRequest) {
  return handleV1(request, () => {
    throw new PolicyRequiredError('accounting-connection', 'No accounting connection is configured. Import reviewed payments with the CSV import on Invoices.');
  });
}
