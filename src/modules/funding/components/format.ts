/**
 * Presentation helpers shared by the finance tabs. Display only.
 */
import { formatMonthShort } from '@/shared/lib/dates';
import { formatMoney, type Money } from '@/shared/lib/money';

/** Whole dollars for tiles and tables. */
export const whole = (value: Money): string => formatMoney(value);

/** Cents for ledgers and movements. */
export const exact = (value: Money): string => formatMoney(value, { showCents: true });

/** "2026-10" → "Oct 2026". */
export function monthLabel(month: string): string {
  return `${formatMonthShort(`${month}-01`)} ${month.slice(0, 4)}`;
}

/** Cents → the plain decimal a form field pre-fills with. */
export function toInput(value: Money): string {
  return (value.cents / 100).toFixed(2);
}
