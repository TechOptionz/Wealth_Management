/**
 * Exact arithmetic for the finance engine (CAL01, CAL02).
 *
 * Money is integer cents, as everywhere else in the platform. Rates are integer
 * **parts per million** (`Ppm`): 10% is `100_000`, so a rate can never be
 * mistaken for the decimal 0.10 and no binary fraction ever reaches a stored
 * total. Anything needing more precision than a cent is carried as a `bigint`
 * numerator over an explicit denominator and rounded half away from zero only
 * at a posting boundary.
 */

/** An integer number of cents. */
export type Cents = number;

/** An integer rate in parts per million: 1% = 10_000, 100% = 1_000_000. */
export type Ppm = number;

export const PPM = 1_000_000;
export const PPM_BIG = 1_000_000n;

export function assertCents(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, received ${value}`);
  }
}

export function assertPpm(value: number, label = 'rate'): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer parts-per-million value, received ${value}`);
  }
}

export function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Amount ${value} is outside the safe integer range.`);
  }
  return Number(value);
}

/** Integer division rounded half away from zero (CAL02). */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero.');
  let top = numerator;
  let bottom = denominator;
  if (bottom < 0n) {
    top = -top;
    bottom = -bottom;
  }
  const negative = top < 0n;
  const magnitude = negative ? -top : top;
  const quotient = magnitude / bottom;
  const remainder = magnitude % bottom;
  const rounded = remainder * 2n >= bottom ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** `cents × numerator ÷ denominator`, exact until one final half-away-from-zero rounding. */
export function mulDivCents(cents: Cents, numerator: number | bigint, denominator: number | bigint): Cents {
  assertCents(cents);
  return toSafeNumber(roundDiv(BigInt(cents) * BigInt(numerator), BigInt(denominator)));
}

/** Apply a ppm rate: 100_000 cents at 100_000 ppm (10%) is 10_000 cents. */
export function applyPpm(cents: Cents, ratePpm: Ppm): Cents {
  assertPpm(ratePpm);
  return mulDivCents(cents, ratePpm, PPM);
}

/**
 * Parse a percentage typed by a person ("10", "10.5", "0.75", "6.25%") into
 * ppm. The digits are read directly, so "10.1" is exactly 101_000 rather than
 * whatever `0.101 * 1e6` happens to be. The finest step is 0.0001%.
 */
export function percentToPpm(text: string | number): Ppm {
  const raw = String(text).trim().replace(/%$/, '').trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new RangeError(`"${text}" is not a percentage.`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fractionDigits = match[3] ?? '';
  if (fractionDigits.length > 4 && /[1-9]/.test(fractionDigits.slice(4))) {
    throw new RangeError(`"${text}" has more than four decimal places; the finest supported step is 0.0001%.`);
  }
  const fraction = BigInt(fractionDigits.padEnd(4, '0').slice(0, 4));
  return toSafeNumber(sign * (whole * 10_000n + fraction));
}

/** "10.00%" from 100_000 ppm. Display only. */
export function formatPpmAsPercent(ppm: Ppm, fractionDigits = 2): string {
  assertPpm(ppm);
  const digits = Math.max(0, Math.min(4, fractionDigits));
  const unit = 10n ** BigInt(4 - digits);
  const scaled = roundDiv(BigInt(Math.abs(ppm)), unit);
  const divisor = 10n ** BigInt(digits);
  const whole = scaled / divisor;
  const fraction = String(scaled % divisor).padStart(digits, '0');
  return `${ppm < 0 ? '−' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}%`;
}

/** A ppm rate as a floating ratio, for solvers and charts only — never for a stored amount. */
export function ppmToRatio(ppm: Ppm): number {
  return ppm / PPM;
}
