/**
 * Sidebar data for Development Finance (§3.1): the projects a person may open,
 * each with its Revenue groups and Cost categories as expandable children, and
 * the count of invoices awaiting approval for the badge. Children are listed
 * only for members who may read financials, so an investor sees the menu
 * without the registers they cannot open.
 */
import type { UserId } from '@/shared/types/common';
import { projectsService } from '@/modules/projects/service';
import { budgetsService } from '@/modules/budgets/service';
import { salesService } from '@/modules/sales/service';
import { invoicesService } from '@/modules/invoices/service';

export interface DevelopmentNavEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly revenue: readonly { readonly id: string; readonly label: string; readonly href: string }[];
  readonly costs: readonly { readonly id: string; readonly label: string; readonly href: string }[];
  readonly awaitingApproval: number;
}

export function developmentNav(userId: UserId): readonly DevelopmentNavEntry[] {
  return projectsService.listVisibleProjects(userId).map((project) => {
    const scope = projectsService.scopeFor(userId, project.id);
    const canRead = scope?.permissions.includes('financials.read') ?? false;
    const base = `/projects/${encodeURIComponent(project.id)}`;
    return {
      id: project.id,
      code: project.code,
      name: project.name,
      revenue: canRead ? salesService.revenueGroupsForNav(project.id).map((group) => ({ id: group.id, label: group.label, href: `${base}/revenue/${encodeURIComponent(group.id)}` })) : [],
      costs: canRead ? budgetsService.listCategories(project.id).map((category) => ({ id: category.id, label: category.name, href: `${base}/costs/${encodeURIComponent(category.id)}` })) : [],
      awaitingApproval: canRead ? invoicesService.awaitingApprovalCount(project.id) : 0,
    };
  });
}
