/**
 * The project permission matrix (§4.2), as code.
 *
 * A role is a bundle of permissions; a grant extends it; financial authority
 * is the approval limit and nothing else. This file is the only place the
 * matrix lives — `service.guard` consults it and every Development Finance
 * `api.ts` calls the guard, so a direct URL cannot bypass it (IAM02).
 */
import type { Money } from '@/shared/lib/money';
import type { ProjectAccess, ProjectGrant, ProjectPermission, ProjectRole } from './model';

type AccessLike = Pick<ProjectAccess, 'role' | 'grants' | 'approvalLimit'>;

function has(access: AccessLike, grant: ProjectGrant): boolean {
  return access.grants.includes(grant);
}

/** The permissions a membership carries. Deny by default: anything not returned is refused. */
export function permissionsFor(access: AccessLike): readonly ProjectPermission[] {
  const permissions = new Set<ProjectPermission>(['project.read']);
  const grant = (...items: ProjectPermission[]): void => items.forEach((item) => permissions.add(item));
  const canApprove = access.approvalLimit !== null;

  switch (access.role) {
    case 'org-admin':
      grant('financials.read', 'members.manage', 'comment.write', 'assistant.use');
      if (has(access, 'project.edit')) {
        grant('project.edit', 'budget.edit', 'programme.edit', 'sales.edit', 'finance.edit', 'period.reopen');
      }
      if (has(access, 'invoice.capture')) grant('invoice.capture');
      if (canApprove) grant('invoice.approve');
      if (has(access, 'payment.record')) grant('payment.record');
      if (has(access, 'accounting.connect')) grant('accounting.connect');
      if (has(access, 'publish')) grant('baseline.publish', 'scenario.publish');
      if (has(access, 'export')) grant('report.export');
      break;
    case 'project-manager':
      grant(
        'financials.read',
        'project.edit',
        'budget.edit',
        'programme.edit',
        'sales.edit',
        'finance.edit',
        'invoice.capture',
        'period.reopen',
        'report.export',
        'comment.write',
        'assistant.use',
      );
      if (has(access, 'members.invite')) grant('members.manage');
      if (canApprove) grant('invoice.approve');
      if (has(access, 'payment.record')) grant('payment.record');
      if (has(access, 'publish')) grant('baseline.publish', 'scenario.publish');
      break;
    case 'finance-officer':
      grant(
        'financials.read',
        'finance.edit',
        'invoice.capture',
        'payment.record',
        'period.reopen',
        'report.export',
        'comment.write',
        'assistant.use',
      );
      if (has(access, 'finance.fields')) grant('budget.edit');
      if (canApprove) grant('invoice.approve');
      if (has(access, 'accounting.connect')) grant('accounting.connect');
      if (has(access, 'publish')) grant('baseline.publish', 'scenario.publish');
      break;
    case 'approver':
      grant('financials.read', 'report.export', 'comment.write', 'assistant.use');
      if (has(access, 'invoice.capture')) grant('invoice.capture');
      if (canApprove) grant('invoice.approve');
      if (has(access, 'payment.record')) grant('payment.record');
      if (has(access, 'publish')) grant('baseline.publish', 'scenario.publish');
      break;
    case 'viewer':
      grant('financials.read', 'assistant.use');
      if (has(access, 'export')) grant('report.export');
      break;
    case 'investor':
      grant('participation.read', 'assistant.use');
      if (has(access, 'export')) grant('report.export');
      break;
  }
  return [...permissions];
}

/** Whether a limit covers an invoice's gross value. A null limit is no authority at all. */
export function limitCovers(limit: Money | null, gross: Money): boolean {
  return limit !== null && limit.cents >= gross.cents;
}

export const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  'org-admin': 'Reads every project and manages members. Editing, capturing, paying and publishing each need a grant; approving needs a limit.',
  'project-manager': 'Edits budgets, programme, sales and funding; captures invoices; exports. Approving needs a limit; publishing needs a grant.',
  'finance-officer': 'Captures and codes invoices, records payments, manages periods. Approving needs a limit; budgets need the financial-fields grant.',
  approver: 'Approves invoices within the assigned limit. Capturing, paying and publishing each need a grant.',
  viewer: 'Reads project financials. Exporting needs a grant.',
  investor: 'Sees only their own participation and the reports shared with them.',
};
