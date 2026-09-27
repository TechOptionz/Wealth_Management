/**
 * Turning what a person typed into typed scenario overrides, in one place so
 * the form action and the JSON route agree (SCN02).
 */
import { percentToPpm } from '@/shared/finance-engine';
import type { ScenarioOverrides } from '@/modules/project-model/model';

export interface RawOverrides {
  readonly unsoldPricePercent?: string;
  readonly costPercent?: string;
  readonly costCategoryIds?: readonly string[];
  readonly includeUnbilledCommitments?: boolean;
  readonly programmeShiftDays?: number;
  readonly facilityRatePercent?: Readonly<Record<string, string>>;
  readonly additionalEquity?: readonly { readonly participantId: string; readonly amount: string }[];
  readonly settlementLagMonths?: number;
  readonly taxRatePercent?: string;
}

function decimalToCents(value: string): number {
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

export function toOverrides(raw: RawOverrides): ScenarioOverrides {
  const overrides: {
    -readonly [K in keyof ScenarioOverrides]: ScenarioOverrides[K];
  } = {};
  if (raw.unsoldPricePercent) overrides.unsoldPriceUpliftPpm = percentToPpm(raw.unsoldPricePercent);
  if (raw.costPercent) {
    overrides.costUplift = {
      ppm: percentToPpm(raw.costPercent),
      ...(raw.costCategoryIds && raw.costCategoryIds.length > 0 ? { categoryIds: raw.costCategoryIds } : {}),
      includeUnbilledCommitments: raw.includeUnbilledCommitments ?? false,
    };
  }
  if (raw.programmeShiftDays) overrides.programmeShiftDays = raw.programmeShiftDays;
  if (raw.facilityRatePercent) {
    const rates: Record<string, number> = {};
    for (const [id, value] of Object.entries(raw.facilityRatePercent)) if (value) rates[id] = percentToPpm(value);
    if (Object.keys(rates).length > 0) overrides.facilityRatePpm = rates;
  }
  if (raw.additionalEquity && raw.additionalEquity.length > 0) {
    overrides.additionalEquity = raw.additionalEquity.map((entry) => ({ participantId: entry.participantId, cents: decimalToCents(entry.amount) }));
  }
  if (raw.settlementLagMonths !== undefined) overrides.settlementLagMonths = raw.settlementLagMonths;
  if (raw.taxRatePercent) overrides.taxRatePpm = percentToPpm(raw.taxRatePercent);
  return overrides;
}

/** Words for a set of overrides, for tables and audit lines. */
export function describeOverrides(overrides: ScenarioOverrides): readonly string[] {
  const lines: string[] = [];
  if (overrides.unsoldPriceUpliftPpm) lines.push(`Unsold prices ${overrides.unsoldPriceUpliftPpm > 0 ? '+' : ''}${(overrides.unsoldPriceUpliftPpm / 10_000).toFixed(2)}%`);
  if (overrides.costUplift) {
    lines.push(
      `${overrides.costUplift.categoryIds ? 'Selected categories' : 'All remaining costs'} ${overrides.costUplift.ppm > 0 ? '+' : ''}${(overrides.costUplift.ppm / 10_000).toFixed(2)}% on the uncommitted forecast${overrides.costUplift.includeUnbilledCommitments ? ' and unbilled commitments' : ''}`,
    );
  }
  if (overrides.programmeShiftDays) lines.push(`Programme ${overrides.programmeShiftDays > 0 ? 'delayed' : 'brought forward'} ${Math.abs(overrides.programmeShiftDays)} days`);
  for (const [id, ppm] of Object.entries(overrides.facilityRatePpm ?? {})) lines.push(`${id} rate ${(ppm / 10_000).toFixed(2)}%`);
  for (const extra of overrides.additionalEquity ?? []) lines.push(`Extra equity from ${extra.participantId}: $${(extra.cents / 100).toFixed(2)}`);
  if (overrides.settlementLagMonths !== undefined) lines.push(`GST lag ${overrides.settlementLagMonths} month(s)`);
  if (overrides.taxRatePpm !== undefined) lines.push(`GST rate ${(overrides.taxRatePpm / 10_000).toFixed(2)}%`);
  return lines.length > 0 ? lines : ['No overrides — the current model'];
}
