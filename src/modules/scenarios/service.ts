/**
 * Scenarios business logic (SCN01–SCN06).
 *
 * Every scenario figure comes from `projectModelService.recalculateFrom`: the
 * pinned base run's frozen input plus this scenario's overrides. A scenario
 * never reads live module data for its actuals, and publishing promotes
 * forecast assumptions only — through each owning module's normal write path,
 * so the usual permission, period and audit rules apply.
 */
import { randomUUID } from 'node:crypto';
import { XIRR_UNAVAILABLE_LABELS, addMonthsToKey, applyPpm, type XirrResult } from '@/shared/finance-engine';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/lib/errors';
import { addDays, daysBetween } from '@/shared/lib/dates';
import { money } from '@/shared/lib/money';
import type { Available } from '@/shared/lib/result';
import { asId, type IsoDate, type MilestoneId, type ProjectId, type ScenarioId, type UserId } from '@/shared/types/common';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { projectModelService } from '@/modules/project-model/service';
import type { CalculationRun, ModelKpis, ScenarioOverrides } from '@/modules/project-model/model';
import { budgetsService } from '@/modules/budgets/service';
import { programmeService } from '@/modules/programme/service';
import { salesService } from '@/modules/sales/service';
import { fundingService } from '@/modules/funding/service';
import { scenariosRepository } from './repository';
import {
  COMPARISON_METRICS,
  METRIC_KIND,
  type ComparisonColumn,
  type ComparisonMetric,
  type MetricValue,
  type Scenario,
  type SensitivityAxis,
  type SensitivityDriver,
  type SensitivityMatrix,
} from './model';

/** SCN03: the current model plus at most three scenarios in one view. */
export const MAX_COMPARED_SCENARIOS = 3;
/** SCN06: bounded increments, so a matrix is never an unbounded batch of runs. */
export const MAX_SENSITIVITY_STEPS = 9;

function actorName(userId: UserId): string {
  return accessService.resolveUserName(userId) ?? 'system';
}

function latestVersion(scenario: Scenario) {
  const version = scenario.versions[scenario.versions.length - 1];
  if (!version) throw new NotFoundError('Scenario version', scenario.id);
  return version;
}

function validateOverrides(overrides: ScenarioOverrides): void {
  const inRange = (ppm: number | undefined, label: string): void => {
    if (ppm === undefined) return;
    if (!Number.isInteger(ppm) || ppm < -500_000 || ppm > 1_000_000) {
      throw new ValidationError(`${label} must be between −50% and +100%.`);
    }
  };
  inRange(overrides.unsoldPriceUpliftPpm, 'The unsold price change');
  inRange(overrides.costUplift?.ppm, 'The cost change');
  if (overrides.programmeShiftDays !== undefined && (!Number.isInteger(overrides.programmeShiftDays) || Math.abs(overrides.programmeShiftDays) > 730)) {
    throw new ValidationError('A programme shift must be a whole number of days within two years.');
  }
  for (const [id, ppm] of Object.entries(overrides.facilityRatePpm ?? {})) {
    if (!Number.isInteger(ppm) || ppm < 0 || ppm > 500_000) throw new ValidationError(`The rate for ${id} must be between 0% and 50%.`);
  }
  for (const extra of overrides.additionalEquity ?? []) {
    if (!Number.isInteger(extra.cents) || extra.cents < 0) throw new ValidationError('Additional equity must be zero or more.');
  }
  if (overrides.settlementLagMonths !== undefined && (overrides.settlementLagMonths < 0 || overrides.settlementLagMonths > 6)) {
    throw new ValidationError('The GST settlement lag must be between 0 and 6 months.');
  }
  if (overrides.taxRatePpm !== undefined && (overrides.taxRatePpm < 0 || overrides.taxRatePpm > 300_000)) {
    throw new ValidationError('The GST rate must be between 0% and 30%.');
  }
}

function metricValues(kpis: ModelKpis): Record<ComparisonMetric, MetricValue> {
  const ratio = (value: Available<number>): MetricValue => (value.available ? { value: value.value } : { value: null, unavailableReason: value.reason });
  const irr = (value: XirrResult): MetricValue => (value.available ? { value: value.rate } : { value: null, unavailableReason: XIRR_UNAVAILABLE_LABELS[value.reason] });
  return {
    revenue: { value: kpis.netRevenueCents },
    cost: { value: kpis.economicCostCents },
    financeCost: { value: kpis.financeCostCents },
    profit: { value: kpis.profitCents },
    marginOnCost: ratio(kpis.marginOnCost),
    marginOnRevenue: ratio(kpis.marginOnRevenue),
    projectIrr: irr(kpis.projectIrr),
    equityIrr: irr(kpis.equityIrr),
    peakDebt: { value: kpis.peakDebtCents },
    peakEquity: { value: kpis.peakEquityCents },
    fundingGap: { value: kpis.fundingGapCents },
    completion: { value: kpis.completionDate },
  };
}

function variance(metric: ComparisonMetric, scenario: MetricValue, base: MetricValue): number | null {
  if (scenario.value === null || base.value === null) return null;
  switch (METRIC_KIND[metric]) {
    case 'money':
      return (scenario.value as number) - (base.value as number);
    case 'ratio':
      // Percentage points, not a percentage of a percentage (SCN03).
      return ((scenario.value as number) - (base.value as number)) * 100;
    case 'date':
      return daysBetween(base.value as string, scenario.value as string);
  }
}

function axisValues(axis: SensitivityAxis): number[] {
  if (axis.step <= 0) throw new ValidationError('A sensitivity step must be greater than zero.');
  const values: number[] = [];
  for (let value = axis.from; value <= axis.to + 1e-9; value += axis.step) values.push(Math.round(value * 10_000) / 10_000);
  if (values.length === 0 || values.length > MAX_SENSITIVITY_STEPS) {
    throw new ValidationError(`Each sensitivity axis may have between 1 and ${MAX_SENSITIVITY_STEPS} steps.`);
  }
  return values;
}

function driverOverrides(driver: SensitivityDriver, value: number, run: CalculationRun): ScenarioOverrides {
  switch (driver) {
    case 'unsold-price':
      return { unsoldPriceUpliftPpm: Math.round(value * 10_000) };
    case 'uncommitted-construction': {
      const construction = run.input.categories.filter((category) => category.code === 'CON').map((category) => category.id);
      return { costUplift: { ppm: Math.round(value * 10_000), categoryIds: construction, includeUnbilledCommitments: false } };
    }
    case 'remaining-cost':
      return { costUplift: { ppm: Math.round(value * 10_000), includeUnbilledCommitments: false } };
    case 'interest-rate': {
      const rates: Record<string, number> = {};
      for (const facility of run.input.facilities) {
        const current = facility.terms.rateSteps[facility.terms.rateSteps.length - 1]?.ratePpm ?? 0;
        rates[facility.id] = Math.max(0, current + Math.round(value * 10_000));
      }
      return { facilityRatePpm: rates };
    }
    case 'programme-delay':
      return { programmeShiftDays: Math.round(value) };
  }
}

/** Combine two override sets; a cost uplift from each axis is summed when both target the same lines. */
function mergeOverrides(a: ScenarioOverrides, b: ScenarioOverrides): ScenarioOverrides {
  const merged: ScenarioOverrides = { ...a, ...b };
  if (a.costUplift && b.costUplift) {
    // Two cost drivers at once: apply the broader one and add the narrower on top is not expressible
    // in a single uplift, so the matrix refuses the pairing instead of approximating it.
    throw new ValidationError('Choose two different kinds of driver: two cost drivers cannot be combined in one matrix.');
  }
  if (a.facilityRatePpm && b.facilityRatePpm) throw new ValidationError('Choose two different drivers.');
  return merged;
}

export const scenariosService = {
  list(projectId: ProjectId): readonly Scenario[] {
    return scenariosRepository.list(projectId);
  },

  require(id: ScenarioId): Scenario {
    const scenario = scenariosRepository.find(id);
    if (!scenario) throw new NotFoundError('Scenario', id);
    return scenario;
  },

  /** SCN01 — fork from an immutable snapshot of the current model. */
  create(input: { readonly projectId: ProjectId; readonly name: string; readonly description?: string; readonly overrides: ScenarioOverrides; readonly actor: UserId }): Scenario {
    projectsService.require(input.projectId);
    if (!input.name.trim()) throw new ValidationError('Name the scenario.', { fieldErrors: { name: ['A scenario needs a name.'] } });
    validateOverrides(input.overrides);
    const base = projectModelService.calculate(input.projectId, { actor: input.actor });
    const at = new Date().toISOString();
    const scenario: Scenario = {
      id: asId<'Scenario'>(`scn-${randomUUID()}`),
      projectId: input.projectId,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      state: 'draft',
      overrides: input.overrides,
      versions: [{ version: 1, baseRunId: base.id, baseRevision: base.modelRevision, actualsCutoff: base.actualsCutoff, at, by: input.actor, reason: 'Created from the current model' }],
      createdAt: at,
      createdBy: input.actor,
    };
    const created = scenariosRepository.insert(scenario);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Scenario created · ${created.name}`,
      context: `${projectsService.require(input.projectId).code} · base run rev ${base.modelRevision} · actuals to ${base.actualsCutoff}`,
    });
    return created;
  },

  updateOverrides(id: ScenarioId, overrides: ScenarioOverrides, actor: UserId): Scenario {
    const scenario = scenariosService.require(id);
    if (scenario.state !== 'draft') throw new ConflictError('Only a draft scenario can be changed.');
    validateOverrides(overrides);
    const updated = scenariosRepository.update(id, { overrides });
    if (!updated) throw new NotFoundError('Scenario', id);
    accessService.record({ actor: actorName(actor), summary: `Scenario assumptions changed · ${scenario.name}`, context: JSON.stringify(overrides) });
    return updated;
  },

  /** The pinned base run. A seeded scenario pins the current model the first time it is calculated. */
  baseRun(scenario: Scenario): CalculationRun {
    const version = latestVersion(scenario);
    if (version.baseRunId) return projectModelService.requireRun(version.baseRunId);
    return projectModelService.calculate(scenario.projectId);
  },

  /** Scenario run: the base's frozen input plus this scenario's overrides. */
  calculate(id: ScenarioId, actor?: UserId): CalculationRun {
    const scenario = scenariosService.require(id);
    return projectModelService.recalculateFrom(scenariosService.baseRun(scenario), scenario.overrides, scenario.id, actor);
  },

  /** A scenario is stale when the current model has moved past its pinned base (SCN04). */
  isStale(scenario: Scenario): boolean {
    return latestVersion(scenario).baseRevision !== projectsService.require(scenario.projectId).modelRevision;
  },

  /** SCN04 — pull in new actuals explicitly: a new version with the reason and the cutoff change. */
  refresh(id: ScenarioId, actor: UserId): Scenario {
    const scenario = scenariosService.require(id);
    if (scenario.state === 'archived') throw new ConflictError('An archived scenario cannot be refreshed.');
    const previous = latestVersion(scenario);
    const base = projectModelService.calculate(scenario.projectId, { actor });
    const reason =
      base.actualsCutoff === previous.actualsCutoff
        ? `Refreshed to model revision ${base.modelRevision}; actuals cutoff unchanged at ${base.actualsCutoff}`
        : `Refreshed to model revision ${base.modelRevision}; actuals cutoff moved ${previous.actualsCutoff} → ${base.actualsCutoff}`;
    const updated = scenariosRepository.update(id, {
      versions: [
        ...scenario.versions,
        { version: previous.version + 1, baseRunId: base.id, baseRevision: base.modelRevision, actualsCutoff: base.actualsCutoff, at: new Date().toISOString(), by: actor, reason },
      ],
    });
    if (!updated) throw new NotFoundError('Scenario', id);
    accessService.record({ actor: actorName(actor), summary: `Scenario refreshed · ${scenario.name}`, context: reason });
    return updated;
  },

  archive(id: ScenarioId, actor: UserId, reason: string): Scenario {
    const scenario = scenariosService.require(id);
    if (!reason.trim()) throw new ValidationError('Give a reason.', { fieldErrors: { reason: ['A reason is required.'] } });
    const updated = scenariosRepository.update(id, { state: 'archived' });
    if (!updated) throw new NotFoundError('Scenario', id);
    accessService.record({ actor: actorName(actor), summary: `Scenario archived · ${scenario.name}`, context: reason });
    return updated;
  },

  /** SCN03 — the current model and up to three scenarios, each with its variance to the model. */
  compare(projectId: ProjectId, scenarioIds: readonly ScenarioId[], basis: 'economic' | 'gross' = 'economic'): readonly ComparisonColumn[] {
    const unique = [...new Set(scenarioIds)];
    if (unique.length > MAX_COMPARED_SCENARIOS) {
      throw new ValidationError(`Compare at most ${MAX_COMPARED_SCENARIOS} scenarios with the current model.`);
    }
    const current = projectModelService.calculate(projectId);
    const baseValues = metricValues(projectModelService.view(current, basis).kpis);
    const columns: ComparisonColumn[] = [
      { key: 'current', label: 'Current model', runId: current.id, stale: false, values: baseValues, variances: null },
    ];
    for (const id of unique) {
      const scenario = scenariosService.require(id);
      if (scenario.projectId !== projectId) throw new NotFoundError('Scenario', id);
      const run = scenariosService.calculate(id);
      const values = metricValues(projectModelService.view(run, basis).kpis);
      const variances = Object.fromEntries(COMPARISON_METRICS.map((metric) => [metric, variance(metric, values[metric], baseValues[metric])])) as Record<ComparisonMetric, number | null>;
      columns.push({ key: id, label: scenario.name, runId: run.id, stale: scenariosService.isStale(scenario), values, variances });
    }
    return columns;
  },

  /** SCN06 — a bounded two-driver matrix of profit, every cell on the same pinned base. */
  sensitivity(input: { readonly projectId: ProjectId; readonly scenarioId?: ScenarioId; readonly rows: SensitivityAxis; readonly columns: SensitivityAxis }): SensitivityMatrix {
    if (input.rows.driver === input.columns.driver) throw new ValidationError('Choose two different drivers.');
    const base = input.scenarioId ? scenariosService.baseRun(scenariosService.require(input.scenarioId)) : projectModelService.calculate(input.projectId);
    const scenarioOverrides = input.scenarioId ? scenariosService.require(input.scenarioId).overrides : {};
    const rowValues = axisValues(input.rows);
    const columnValues = axisValues(input.columns);
    const profit: number[][] = [];
    const margin: (number | null)[][] = [];
    for (const rowValue of rowValues) {
      const profitRow: number[] = [];
      const marginRow: (number | null)[] = [];
      for (const columnValue of columnValues) {
        const overrides = mergeOverrides(
          mergeOverrides(driverOverrides(input.rows.driver, rowValue, base), driverOverrides(input.columns.driver, columnValue, base)),
          scenarioOverrides,
        );
        // Computed without storing: a matrix is an analysis, not a published result.
        const kpis = projectModelService.computeEphemeral(base.input, overrides).economic.kpis;
        profitRow.push(kpis.profitCents);
        marginRow.push(kpis.marginOnCost.available ? kpis.marginOnCost.value : null);
      }
      profit.push(profitRow);
      margin.push(marginRow);
    }
    return {
      rows: input.rows,
      columns: input.columns,
      rowValues,
      columnValues,
      profit,
      marginOnCost: margin,
      baseProfitCents: projectModelService.view(base, 'economic').kpis.profitCents,
      baseRunId: base.id,
    };
  },

  /** What publishing would change, without changing anything (SCN05 change preview). */
  publishPreview(id: ScenarioId): { readonly changes: readonly string[]; readonly notPromoted: readonly string[]; readonly stale: boolean } {
    const scenario = scenariosService.require(id);
    const o = scenario.overrides;
    const projectId = scenario.projectId;
    const changes: string[] = [];
    const notPromoted: string[] = [];
    if (o.costUplift && o.costUplift.ppm !== 0) {
      const run = scenariosService.baseRun(scenario);
      const lines = run.result.positions.filter((position) => (!o.costUplift?.categoryIds || o.costUplift.categoryIds.includes(position.categoryId)));
      for (const position of lines) {
        const line = run.input.lines.find((candidate) => candidate.id === position.lineId);
        if (!line) continue;
        const uncommitted = Math.max(line.budgetNetCents - line.commitments.reduce((sum, c) => sum + c.revisedNetCents, 0), 0);
        const delta = applyPpm(uncommitted, o.costUplift.ppm);
        if (delta !== 0) changes.push(`${line.code}: working budget ${delta > 0 ? '+' : '−'}$${(Math.abs(delta) / 100).toFixed(2)} (uncommitted allowance)`);
      }
      if (o.costUplift.includeUnbilledCommitments) notPromoted.push('Uplift on unbilled commitments — contract values change only through an approved variation.');
    }
    if (o.unsoldPriceUpliftPpm) changes.push(`Forecast price of every uncontracted unit ${o.unsoldPriceUpliftPpm > 0 ? '+' : ''}${(o.unsoldPriceUpliftPpm / 10_000).toFixed(2)}%; contracted units skipped`);
    if (o.programmeShiftDays) {
      const open = programmeService.listMilestones(projectId).filter((m) => !m.actualDate && m.plannedDate > projectsService.policyFor(projectId).actualsCutoff);
      changes.push(`${open.length} open milestone(s) moved ${o.programmeShiftDays} days; recorded actual dates untouched`);
    }
    for (const [facilityId, ppm] of Object.entries(o.facilityRatePpm ?? {})) {
      changes.push(`Facility ${facilityId}: new rate step ${(ppm / 10_000).toFixed(2)}% from the first open month`);
    }
    if (o.taxRatePpm !== undefined || o.settlementLagMonths !== undefined) changes.push('New project policy version with the scenario’s GST rate and settlement lag');
    if ((o.additionalEquity ?? []).length > 0) notPromoted.push('Additional equity — an investor commitment changes only through a signed agreement.');
    return { changes, notPromoted, stale: scenariosService.isStale(scenario) };
  },

  /**
   * SCN05 — promote a scenario's forecast assumptions into the current model.
   *
   * Needs publisher authority (checked by the caller), a reason and an up to
   * date base. Each change goes through its owning module's normal write, so
   * locked periods, contracts and approvals are protected by the same rules as
   * a manual edit. Never touches payments, suppliers or historical approvals.
   */
  publish(input: { readonly scenarioId: ScenarioId; readonly actor: UserId; readonly reason: string }): Scenario {
    const scenario = scenariosService.require(input.scenarioId);
    if (!input.reason.trim()) throw new ValidationError('Give a reason for publishing.', { fieldErrors: { reason: ['A reason is required.'] } });
    if (scenario.state !== 'draft') throw new ConflictError('Only a draft scenario can be published.');
    if (scenariosService.isStale(scenario)) {
      throw new ConflictError('The model has changed since this scenario was based on it. Refresh the scenario, review it, then publish.', {
        baseRevision: latestVersion(scenario).baseRevision,
        currentRevision: projectsService.require(scenario.projectId).modelRevision,
      });
    }
    projectsService.assertMutable(scenario.projectId);
    const preview = scenariosService.publishPreview(scenario.id);
    const projectId = scenario.projectId;
    const o = scenario.overrides;
    const reason = `Scenario "${scenario.name}" published · ${input.reason.trim()}`;

    if (o.costUplift && o.costUplift.ppm !== 0) {
      const run = scenariosService.baseRun(scenario);
      for (const line of run.input.lines) {
        if (line.rowType !== 'posting') continue;
        if (o.costUplift.categoryIds && !o.costUplift.categoryIds.includes(line.categoryId)) continue;
        if (o.costUplift.lineIds && !o.costUplift.lineIds.includes(line.id)) continue;
        const uncommitted = Math.max(line.budgetNetCents - line.commitments.reduce((sum, c) => sum + c.revisedNetCents, 0), 0);
        const delta = applyPpm(uncommitted, o.costUplift.ppm);
        if (delta === 0) continue;
        budgetsService.recordAdjustment({
          projectId,
          kind: 'scope-change',
          ...(delta > 0 ? { toLineId: asId<'CostLine'>(line.id) } : { fromLineId: asId<'CostLine'>(line.id) }),
          amount: money(Math.abs(delta)),
          reason,
          actor: input.actor,
        });
      }
    }
    if (o.unsoldPriceUpliftPpm) {
      salesService.bulkPriceChange({ projectId, mode: 'percent', valuePpm: o.unsoldPriceUpliftPpm, includeContracted: false, actor: input.actor });
    }
    if (o.programmeShiftDays) {
      const cutoff = projectsService.policyFor(projectId).actualsCutoff;
      const targets = programmeService
        .listMilestones(projectId)
        .filter((m) => !m.actualDate && m.plannedDate > cutoff)
        .map((m) => ({ id: m.id, target: addDays(m.plannedDate, o.programmeShiftDays ?? 0) }))
        .sort((a, b) => a.target.localeCompare(b.target));
      for (const target of targets) {
        const current = programmeService.requireMilestone(target.id as MilestoneId);
        if (current.plannedDate >= target.target) continue; // already pushed by a predecessor's cascade
        programmeService.applyMove({ milestoneId: current.id, newPlannedDate: target.target, actor: input.actor, reason });
      }
    }
    for (const [facilityId, ppm] of Object.entries(o.facilityRatePpm ?? {})) {
      const firstOpen = `${addMonthsToKey(projectsService.policyFor(projectId).actualsCutoff.slice(0, 7), 1)}-01`;
      fundingService.addRateStep({ facilityId: asId<'DebtFacility'>(facilityId), from: firstOpen, ratePpm: ppm, actor: input.actor });
    }
    if (o.taxRatePpm !== undefined || o.settlementLagMonths !== undefined) {
      projectsService.newPolicyVersion(
        projectId,
        { tax: { ...(o.taxRatePpm !== undefined ? { standardRatePpm: o.taxRatePpm } : {}), ...(o.settlementLagMonths !== undefined ? { settlementLagMonths: o.settlementLagMonths } : {}) } },
        input.actor,
        reason,
      );
    }

    const published = scenariosRepository.update(scenario.id, {
      state: 'published',
      publishedAt: new Date().toISOString(),
      publishedBy: input.actor,
      publishReason: input.reason.trim(),
      publishedChanges: preview.changes,
    });
    if (!published) throw new NotFoundError('Scenario', scenario.id);
    accessService.record({
      actor: actorName(input.actor),
      summary: `Scenario published · ${scenario.name}`,
      context: `${preview.changes.length} forecast change(s) promoted${preview.notPromoted.length ? ` · not promoted: ${preview.notPromoted.join('; ')}` : ''} · ${input.reason.trim()}`,
    });
    return published;
  },
};

export type { IsoDate };
