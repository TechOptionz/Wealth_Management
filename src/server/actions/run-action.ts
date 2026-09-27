/**
 * `runAction` for Server Actions.
 *
 * The shared helper in `@/shared/lib/action-result` turns failures into a
 * displayable result. This wrapper additionally runs the work inside a unit of
 * work, so an action's writes reach the database when it succeeds and are
 * discarded when it fails. It lives under `server/` because the shared helper
 * is also imported by client components and must stay free of server modules.
 */
import { runAction as runActionResult, type ActionResult } from '@/shared/lib/action-result';
import { withUnitOfWork } from '@/server/db/unit-of-work';

export function runAction<T>(
  successMessage: string | ((value: T) => string),
  work: () => T | Promise<T>,
): Promise<ActionResult<T>> {
  return runActionResult(successMessage, () => withUnitOfWork(work));
}
