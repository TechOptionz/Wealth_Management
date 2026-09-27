'use server';

import { revalidatePath } from 'next/cache';
import { asId } from '@/shared/types/common';
import type { ActionResult } from '@/shared/lib/action-result';
import { runAction } from '@/server/actions/run-action';
import { readBoolean, readString, requireString } from '@/shared/lib/form-data';
import { ValidationError } from '@/shared/lib/errors';
import { accessService } from '@/modules/access/service';
import { projectsService } from '@/modules/projects/service';
import { scenariosService } from './service';
import { toOverrides, type RawOverrides } from './overrides';
import type { SensitivityDriver } from './model';

const PERCENT = /^-?\d+(\.\d{1,4})?$/;

function revalidate(projectId: string): void {
  revalidatePath(`/projects/${projectId}`, 'layout');
}

function readPercent(form: FormData, key: string): string | undefined {
  const raw = readString(form, key)?.replace(/%$/, '');
  if (raw === undefined) return undefined;
  if (!PERCENT.test(raw)) throw new ValidationError(`"${raw}" is not a percentage.`, { fieldErrors: { [key]: ['Enter a percentage such as 5 or -2.5.'] } });
  return raw;
}

function readOverrides(form: FormData): RawOverrides {
  const days = readString(form, 'programmeShiftDays');
  const lag = readString(form, 'settlementLagMonths');
  const facilityRates: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string' && key.startsWith('rate:') && value.trim() !== '') {
      const percent = value.trim().replace(/%$/, '');
      if (!PERCENT.test(percent)) throw new ValidationError(`"${value}" is not a rate.`, { fieldErrors: { [key]: ['Enter a rate such as 8.75.'] } });
      facilityRates[key.slice(5)] = percent;
    }
  }
  const categories = form.getAll('costCategoryIds').filter((value): value is string => typeof value === 'string' && value !== '');
  return {
    unsoldPricePercent: readPercent(form, 'unsoldPricePercent'),
    costPercent: readPercent(form, 'costPercent'),
    costCategoryIds: categories,
    includeUnbilledCommitments: readBoolean(form, 'includeUnbilledCommitments'),
    ...(days ? { programmeShiftDays: Number(days) } : {}),
    ...(Object.keys(facilityRates).length > 0 ? { facilityRatePercent: facilityRates } : {}),
    ...(lag ? { settlementLagMonths: Number(lag) } : {}),
    taxRatePercent: readPercent(form, 'taxRatePercent'),
  };
}

/** SCN01/SCN02 — create a scenario pinned to the current model. */
export async function createScenarioAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Scenario created', () => {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'budget.edit');
    const created = scenariosService.create({
      projectId,
      name: requireString(form, 'name', 'Scenario name'),
      description: readString(form, 'description'),
      overrides: toOverrides(readOverrides(form)),
      actor: accessService.getCurrentUser().id,
    });
    revalidate(projectId);
    return created;
  });
}

export async function updateScenarioAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Scenario assumptions saved', () => {
    accessService.guard('development.read');
    const scenario = scenariosService.require(asId<'Scenario'>(requireString(form, 'scenarioId', 'Scenario')));
    projectsService.guard(scenario.projectId, 'budget.edit');
    const updated = scenariosService.updateOverrides(scenario.id, toOverrides(readOverrides(form)), accessService.getCurrentUser().id);
    revalidate(scenario.projectId);
    return updated;
  });
}

/** SCN04 — pull new actuals into the scenario as a new version. */
export async function refreshScenarioAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Scenario refreshed · new version created', () => {
    accessService.guard('development.read');
    const scenario = scenariosService.require(asId<'Scenario'>(requireString(form, 'scenarioId', 'Scenario')));
    projectsService.guard(scenario.projectId, 'budget.edit');
    const updated = scenariosService.refresh(scenario.id, accessService.getCurrentUser().id);
    revalidate(scenario.projectId);
    return updated;
  });
}

/** SCN05 — publish with authority, a reason and an up to date base. */
export async function publishScenarioAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Scenario published · forecast assumptions promoted', () => {
    accessService.guard('development.read');
    const scenario = scenariosService.require(asId<'Scenario'>(requireString(form, 'scenarioId', 'Scenario')));
    projectsService.guard(scenario.projectId, 'scenario.publish');
    const published = scenariosService.publish({ scenarioId: scenario.id, actor: accessService.getCurrentUser().id, reason: requireString(form, 'reason', 'Reason') });
    revalidate(scenario.projectId);
    return published;
  });
}

export async function archiveScenarioAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Scenario archived', () => {
    accessService.guard('development.read');
    const scenario = scenariosService.require(asId<'Scenario'>(requireString(form, 'scenarioId', 'Scenario')));
    projectsService.guard(scenario.projectId, 'budget.edit');
    const archived = scenariosService.archive(scenario.id, accessService.getCurrentUser().id, requireString(form, 'reason', 'Reason'));
    revalidate(scenario.projectId);
    return archived;
  });
}

const DRIVERS: readonly SensitivityDriver[] = ['unsold-price', 'uncommitted-construction', 'remaining-cost', 'interest-rate', 'programme-delay'];

/** SCN06 — compute a matrix; returned as the action value, never stored. */
export async function sensitivityAction(_previous: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> {
  return runAction('Sensitivity calculated', () => {
    accessService.guard('development.read');
    const projectId = asId<'Project'>(requireString(form, 'projectId', 'Project'));
    projectsService.guard(projectId, 'financials.read');
    const axis = (prefix: string) => {
      const driver = readString(form, `${prefix}Driver`) as SensitivityDriver | undefined;
      if (!driver || !DRIVERS.includes(driver)) throw new ValidationError('Choose a driver for each axis.');
      const number = (key: string): number => {
        const value = Number(requireString(form, `${prefix}${key}`, `${prefix} ${key}`));
        if (!Number.isFinite(value)) throw new ValidationError(`${prefix} ${key} must be a number.`);
        return value;
      };
      return { driver, from: number('From'), to: number('To'), step: number('Step') };
    };
    const scenarioId = readString(form, 'scenarioId');
    return scenariosService.sensitivity({ projectId, ...(scenarioId ? { scenarioId: asId<'Scenario'>(scenarioId) } : {}), rows: axis('row'), columns: axis('col') });
  });
}
