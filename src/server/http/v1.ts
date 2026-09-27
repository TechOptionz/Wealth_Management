/**
 * Helpers for the versioned Development Finance API under /api/v1 (API01–API03).
 *
 *  - Money on the wire is `{ amount: "1860.00", currency: "AUD" }` — a decimal
 *    string, never a binary float (CAL01).
 *  - Every response carries a `request_id`.
 *  - `If-Match` carries the entity revision a financial update was made
 *    against; the service turns a stale one into a 409 (API02).
 *  - `Idempotency-Key` on create/approve/publish/import requests: an identical
 *    retry returns the stored result, a different body under the same key is
 *    refused (API03).
 *
 * Error codes map exactly as the rest of the app: 400 validation, 403
 * insufficient authority, 404 non-disclosing, 409 stale revision or conflict,
 * 422 policy required.
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { z, ZodTypeAny } from 'zod';
import { withUnitOfWork } from '@/server/db/unit-of-work';
import { AppError, ConflictError, ValidationError, isAppError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { hashRequest, idempotencyStore } from './idempotency';

const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  POLICY_REQUIRED: 422,
  INTERNAL: 500,
} as const;

/** Integer cents → "1860.00" (negative "-412.50"). */
export function centsToDecimalString(cents: number): string {
  const magnitude = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}

/** "1860.00" → 186000. Rejects anything that is not a plain decimal with at most two places. */
export function decimalStringToCents(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new ValidationError(`"${value}" is not a decimal amount such as 1860.00.`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

function isMoney(value: unknown): value is { cents: number; currency: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cents' in value &&
    'currency' in value &&
    typeof (value as { cents: unknown }).cents === 'number' &&
    Object.keys(value).length === 2
  );
}

/** Convert a service result to the wire shape: Money becomes a decimal string with its currency. */
export function toWire(value: unknown): unknown {
  if (isMoney(value)) return { amount: centsToDecimalString(value.cents), currency: value.currency };
  if (Array.isArray(value)) return value.map(toWire);
  if (value instanceof Map) return toWire(Object.fromEntries(value));
  if (value instanceof Set) return toWire([...value]);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toWire(entry)]));
  }
  return value;
}

export function readIfMatch(request: NextRequest): number | undefined {
  const raw = request.headers.get('if-match');
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
  const parsed = Number(cleaned);
  if (!Number.isInteger(parsed) || parsed < 0) throw new ValidationError('If-Match must carry the integer model revision you edited against.');
  return parsed;
}

export interface V1Context<TBody> {
  readonly body: TBody;
  readonly ifMatch: number | undefined;
  readonly requestId: string;
}

export interface V1Options<S extends ZodTypeAny> {
  readonly schema?: S;
  readonly status?: number;
  /** Require an Idempotency-Key (create, approve, publish, import, external effect). */
  readonly idempotent?: boolean;
}

function envelope(requestId: string, status: number, body: object): NextResponse {
  return NextResponse.json({ ...body, request_id: requestId }, { status });
}

function errorBody(error: unknown): { readonly status: number; readonly body: object } {
  const appError = isAppError(error) ? error : new AppError('INTERNAL', 'An unexpected error occurred.');
  if (!isAppError(error)) console.error('[holdfast] unhandled v1 error', error);
  return {
    status: STATUS_BY_CODE[appError.code],
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details === undefined ? {} : { details: toWire(appError.details) }),
      },
    },
  };
}

/**
 * Run a v1 handler: parse and validate the body, honour Idempotency-Key and
 * If-Match, run inside a unit of work, and wrap the result in the envelope.
 */
export async function handleV1<S extends ZodTypeAny, T>(
  request: NextRequest,
  work: (context: V1Context<z.infer<S>>) => T | Promise<T>,
  options: V1Options<S> = {},
): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    let raw: unknown = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const text = await request.text();
      if (text.trim() !== '') {
        try {
          raw = JSON.parse(text);
        } catch {
          throw new ValidationError('Request body must be valid JSON.');
        }
      }
    }
    let body: z.infer<S> = raw as z.infer<S>;
    if (options.schema) {
      const parsed = options.schema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new ValidationError('The submitted values are not valid.', {
          fields: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), rule: issue.code, message: issue.message })),
        });
      }
      body = parsed.data;
    }
    const ifMatch = readIfMatch(request);
    const key = request.headers.get('idempotency-key')?.trim();
    if (options.idempotent && !key) {
      throw new ValidationError('This request needs an Idempotency-Key header so a retry cannot repeat its effect.');
    }

    const status = options.status ?? 200;
    const result = await withUnitOfWork(async () => {
      const scopedKey = key ? `${accessService.getCurrentUser().id}:${key}` : undefined;
      const requestHash = hashRequest([request.method, request.nextUrl.pathname, raw ?? null, ifMatch ?? null]);
      if (scopedKey) {
        const stored = idempotencyStore.find(scopedKey);
        if (stored) {
          if (stored.requestHash !== requestHash) {
            throw new ConflictError('This Idempotency-Key was already used with a different request.');
          }
          return { replay: true as const, status: stored.status, body: JSON.parse(stored.responseJson) as object };
        }
      }
      const data = toWire(await work({ body, ifMatch, requestId }));
      const responseBody = { data };
      if (scopedKey) {
        idempotencyStore.save({
          id: scopedKey,
          requestHash,
          status,
          responseJson: JSON.stringify(responseBody),
          createdAt: new Date().toISOString(),
        });
      }
      return { replay: false as const, status, body: responseBody };
    });
    return envelope(requestId, result.status, result.replay ? { ...result.body, replayed: true } : result.body);
  } catch (error) {
    const { status, body } = errorBody(error);
    return envelope(requestId, status, body);
  }
}

/** Query-string parsing for v1 list endpoints. */
export function parseV1Query<S extends ZodTypeAny>(request: NextRequest, schema: S): z.infer<S> {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('The supplied filters are not valid.', {
      fields: result.error.issues.map((issue) => ({ field: issue.path.join('.'), rule: issue.code, message: issue.message })),
    });
  }
  return result.data;
}
