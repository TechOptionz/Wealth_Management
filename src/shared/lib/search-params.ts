/**
 * Reading Next.js page `searchParams`.
 *
 * A query key can arrive as a string, as an array (`?a=1&a=2`) or not at all.
 * Pages want one trimmed string or nothing, so that decision lives here.
 */
export function firstParam(value: string | readonly string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}
