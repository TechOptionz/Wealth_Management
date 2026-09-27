/**
 * Application-wide configuration resolved once at module load.
 * Server-only values must not be referenced from client components.
 *
 * Environment values are a trust boundary. Hosting dashboards (Vercel,
 * Netlify, …) store what was typed verbatim, so a line pasted from
 * `.env.example` arrives as `"en-AU"` — quotes included — and an accidental
 * blank arrives as "". Everything read here goes through `readEnv` so a
 * malformed value degrades to the default instead of taking the app down.
 */
import type { CurrencyCode, IsoDate } from '@/shared/types/common';

export const DEFAULT_LOCALE = 'en-AU';

/**
 * Read an environment value the way a person typed it. Trims whitespace,
 * strips one pair of matching surrounding quotes, and treats blank as unset.
 */
export function readEnv(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let value = raw.trim();
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  if (quoted) value = value.slice(1, -1).trim();
  return value === '' ? undefined : value;
}

/**
 * Resolve the formatting locale, falling back to the default whenever the
 * configured value is not a tag `Intl` supports.
 *
 * An invalid tag ("", "en_AU", "\"en-AU\"") would otherwise throw
 * `RangeError: Incorrect locale information provided` from every
 * `formatMoney` call. That surfaces while prerendering during `next build`,
 * so one bad dashboard value fails the whole deployment rather than a page.
 */
export function resolveLocale(raw: string | undefined): string {
  const candidate = readEnv(raw);
  if (!candidate) return DEFAULT_LOCALE;
  try {
    return Intl.NumberFormat.supportedLocalesOf([candidate]).length > 0 ? candidate : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export const APP_NAME = readEnv(process.env.NEXT_PUBLIC_APP_NAME) ?? 'Holdfast';
export const APP_TAGLINE = 'Wealth & property operations';
export const BASE_CURRENCY: CurrencyCode = 'AUD';
export const LOCALE = resolveLocale(process.env.NEXT_PUBLIC_LOCALE);

/**
 * A valuation older than this is presented as stale (design rule: "every total carries a date").
 */
export const STALE_VALUATION_MONTHS = 12;

/** Horizon used by the dashboard "Due in next N days" tile and list (FR-09). */
export const UPCOMING_WINDOW_DAYS = 14;

/**
 * The date the read models are evaluated against.
 *
 * The design prototype is pinned to 6 Sep 2026 and the seeded data is authored
 * relative to that date, so the default keeps the running app identical to the
 * prototype. Unset AS_OF_DATE (or set it to "today") to track the real clock.
 */
export function resolveAsOfDate(): IsoDate {
  const configured = readEnv(process.env.AS_OF_DATE);
  if (configured && configured !== 'today') return configured;
  if (!configured) return '2026-09-06';
  return new Date().toISOString().slice(0, 10);
}
