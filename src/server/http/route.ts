/**
 * Route-handler helpers.
 *
 * `handle` wraps a module API function so every route gets identical error
 * handling without repeating try/catch in each file.
 *
 * The work runs inside a unit of work, so its reads see one consistent snapshot
 * and its writes are saved together when it succeeds.
 */
import type { NextRequest, NextResponse } from 'next/server';
import { jsonOk, jsonError, type ApiFailure, type ApiSuccess } from './respond';
import { withUnitOfWork } from '@/server/db/unit-of-work';
import { ValidationError } from '@/shared/lib/errors';
import type { z, ZodTypeAny } from 'zod';

export type RouteContext<TParams extends Record<string, string> = Record<string, string>> = {
  params: Promise<TParams>;
};

export function handle<T>(
  work: () => T | Promise<T>,
  status = 200,
): Promise<NextResponse<ApiSuccess<T> | ApiFailure>> {
  return Promise.resolve()
    .then(() => withUnitOfWork(work))
    .then((data) => jsonOk(data, status) as NextResponse<ApiSuccess<T> | ApiFailure>)
    .catch((error: unknown) => jsonError(error) as NextResponse<ApiSuccess<T> | ApiFailure>);
}

/**
 * Parse and validate a JSON request body, converting Zod issues into a
 * ValidationError. Generic over the schema (not its type) so `.default()` values
 * are reflected in the returned type.
 */
export async function parseBody<S extends ZodTypeAny>(request: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('The submitted values are not valid.', result.error.flatten());
  }
  return result.data;
}

/** Parse and validate query-string parameters against a schema. */
export function parseQuery<S extends ZodTypeAny>(request: NextRequest, schema: S): z.infer<S> {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('The supplied filters are not valid.', result.error.flatten());
  }
  return result.data;
}
