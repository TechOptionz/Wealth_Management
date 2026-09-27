/**
 * Tax arithmetic (CAL08–CAL12).
 *
 * The standard rate is configuration, not a constant: `gross ÷ 11` is only the
 * 10% special case of `gross × rate ÷ (1 + rate)`, so every formula here takes
 * the rate from the settings it is given. Margin scheme treatment stays
 * uncomputable until finance review has supplied a method (CAL11) — asking for
 * it raises rather than guessing.
 */
import { applyPpm, assertCents, mulDivCents, PPM, type Cents, type Ppm } from './decimal';

export type TaxTreatment = 'standard-gst' | 'gst-free' | 'input-taxed' | 'out-of-scope' | 'margin-scheme';

export const TAX_TREATMENTS: readonly TaxTreatment[] = [
  'standard-gst',
  'gst-free',
  'input-taxed',
  'out-of-scope',
  'margin-scheme',
];

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  'standard-gst': 'Standard GST',
  'gst-free': 'GST free',
  'input-taxed': 'Input taxed',
  'out-of-scope': 'Out of scope',
  'margin-scheme': 'Margin scheme',
};

export interface TaxSettings {
  /** The standard GST rate, effective for the period being calculated. */
  readonly standardRatePpm: Ppm;
  /** Off until finance review supplies eligibility, method and basis (CAL11). */
  readonly marginSchemeEnabled: boolean;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = { standardRatePpm: 100_000, marginSchemeEnabled: false };

export class MarginSchemeUnavailableError extends Error {
  constructor() {
    super('Margin scheme treatment is disabled until finance review supplies the eligibility, method and basis (CAL11).');
    this.name = 'MarginSchemeUnavailableError';
  }
}

function rateFor(treatment: TaxTreatment, settings: TaxSettings): Ppm {
  switch (treatment) {
    case 'standard-gst':
      return settings.standardRatePpm;
    case 'margin-scheme':
      // Even when enabled the liability needs its own reviewed method; nothing
      // generic here may stand in for it.
      throw new MarginSchemeUnavailableError();
    case 'gst-free':
    case 'input-taxed':
    case 'out-of-scope':
      return 0;
  }
}

/** Tax on a tax-exclusive amount. */
export function taxOnNet(netCents: Cents, treatment: TaxTreatment, settings: TaxSettings = DEFAULT_TAX_SETTINGS): Cents {
  assertCents(netCents, 'net');
  return applyPpm(netCents, rateFor(treatment, settings));
}

export function grossFromNet(netCents: Cents, treatment: TaxTreatment, settings: TaxSettings = DEFAULT_TAX_SETTINGS): Cents {
  return netCents + taxOnNet(netCents, treatment, settings);
}

/** Tax inside a tax-inclusive amount: `gross × rate ÷ (1 + rate)`. */
export function taxFromGross(grossCents: Cents, treatment: TaxTreatment, settings: TaxSettings = DEFAULT_TAX_SETTINGS): Cents {
  assertCents(grossCents, 'gross');
  const rate = rateFor(treatment, settings);
  if (rate === 0) return 0;
  return mulDivCents(grossCents, rate, PPM + rate);
}

export function netFromGross(grossCents: Cents, treatment: TaxTreatment, settings: TaxSettings = DEFAULT_TAX_SETTINGS): Cents {
  return grossCents - taxFromGross(grossCents, treatment, settings);
}

export function splitGross(
  grossCents: Cents,
  treatment: TaxTreatment,
  settings: TaxSettings = DEFAULT_TAX_SETTINGS,
): { readonly netCents: Cents; readonly taxCents: Cents } {
  const taxCents = taxFromGross(grossCents, treatment, settings);
  return { netCents: grossCents - taxCents, taxCents };
}

/** The recoverable part of a tax amount, given the reviewed recoverable percentage (CAL10). */
export function recoverableTax(taxCents: Cents, recoverablePpm: Ppm): Cents {
  return applyPpm(taxCents, recoverablePpm);
}

/** Economic cost = gross cost less recoverable GST (CAL09). */
export function economicCost(grossCents: Cents, recoverableTaxCents: Cents): Cents {
  assertCents(grossCents, 'gross');
  assertCents(recoverableTaxCents, 'recoverable tax');
  return grossCents - recoverableTaxCents;
}

/** Net revenue = gross consideration less output GST (CAL09). */
export function netRevenue(grossCents: Cents, outputTaxCents: Cents): Cents {
  assertCents(grossCents, 'gross');
  assertCents(outputTaxCents, 'output tax');
  return grossCents - outputTaxCents;
}
