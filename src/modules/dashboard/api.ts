/**
 * Transport-agnostic handlers for the dashboard module.
 */
import { resolveAsOfDate } from '@/shared/config/app-config';
import { asId } from '@/shared/types/common';
import { dashboardService } from './service';
import { scenarioInputs, simulateScenario } from './scenarios';
import { accessService } from '@/modules/access/service';

export const dashboardApi = {
  /**
   * `entityId` narrows the balance-sheet figures to one consolidated entity
   * (FR-09 scope switching). An unknown id falls back to the whole portfolio.
   */
  overview(asOf?: string, entityId?: string) {
    // NFR-01: enforced at the module API, so pages, JSON routes and
    // exports all pass through the same check. A direct URL cannot bypass it.
    accessService.guard('portfolio.totals.read');
    return dashboardService.overview(asOf ?? resolveAsOfDate(), dashboardService.resolveScope(entityId));
  },

  /** Net worth with its components and movement (BR-01). */
  netWorth(asOf?: string, entityId?: string) {
    // NFR-01: enforced at the module API, so pages, JSON routes and
    // exports all pass through the same check. A direct URL cannot bypass it.
    accessService.guard('portfolio.totals.read');
    return dashboardService.netWorth(asOf ?? resolveAsOfDate(), dashboardService.resolveScope(entityId)?.entityId);
  },

  /** Per-entity consolidated positions (BR-02). */
  ownership(asOf?: string, entityId?: string) {
    // NFR-01: enforced at the module API, so pages, JSON routes and
    // exports all pass through the same check. A direct URL cannot bypass it.
    accessService.guard('portfolio.totals.read');
    return dashboardService.ownershipPositions(
      asOf ?? resolveAsOfDate(),
      dashboardService.resolveScope(entityId)?.entityId,
    );
  },

  /** Choices for the scope switcher. */
  scopeOptions() {
    accessService.guard('portfolio.totals.read');
    return dashboardService.scopeOptions();
  },

  /** Inputs for the what-if drawer (FR-11); the drawer runs the arithmetic itself. */
  scenarioInputs(asOf?: string) {
    accessService.guard('portfolio.totals.read');
    return scenarioInputs(asOf ?? resolveAsOfDate());
  },

  /** A what-if scenario evaluated on the server (FR-11). Read-only. */
  simulateScenario(input: {
    readonly rateDeltaPercent: number;
    readonly vacantPropertyIds?: readonly string[];
    readonly asOf?: string;
  }) {
    // NFR-01: the scenario exposes debt balances and rents, so it needs the same
    // capability as the totals it is derived from.
    accessService.guard('portfolio.totals.read');
    return simulateScenario({
      rateDeltaPercent: input.rateDeltaPercent,
      vacantPropertyIds: (input.vacantPropertyIds ?? []).map((id) => asId<'Property'>(id)),
      asOf: input.asOf ?? resolveAsOfDate(),
    });
  },
};
