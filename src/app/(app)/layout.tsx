import type { ReactNode } from 'react';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { AppShell } from '@/shared/shell/AppShell';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { accessService } from '@/modules/access/service';
import { obligationsService } from '@/modules/obligations/service';
import { reconciliationService } from '@/modules/reconciliation/service';
import { sharedBillsService } from '@/modules/shared-bills/service';
import { initialsOf } from '@/shared/components/Avatar';
import { ROLE_LABELS } from '@/modules/access/model';
import { dashboardService } from '@/modules/dashboard/service';
import { developmentNav } from '@/modules/project-model/navigation';
import { getNotifications } from '@/modules/dashboard/notifications';
import { switchUserAction } from '@/modules/access/actions';
import type { AccessRole } from '@/modules/access/model';

/** Roles offered as test personas in the top bar, with what each may see (NFR-01). */
const PERSONA_NOTES: Partial<Record<AccessRole, string>> = {
  'portfolio-owner': 'Full access',
  'operations-delegate': 'Assigned properties only · no net worth',
  'accountant-readonly': 'Approved records · net worth denied',
};

/**
 * Every screen renders per request: the data behind it lives in a store that
 * changes between requests, so nothing here may be prerendered at build time.
 */
export const dynamic = 'force-dynamic';

/**
 * Chrome for every application screen.
 *
 * Runs on the server so the nav badges, scope and as-of date are resolved from
 * live data before the shell renders — no loading flash in the navigation.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  await loadUnitOfWork();
  const asOfDate = resolveAsOfDate();
  const currentUser = accessService.getCurrentUser();
  const developmentProjects = developmentNav(currentUser.id);

  return (
    <AppShell
      asOfDate={asOfDate}
      badges={{
        openObligations: obligationsService.openCount(asOfDate),
        unmatchedTransactions: reconciliationService.unmatchedCount(),
        billsNeedingReview: sharedBillsService.counts()['needs-review'],
        invoicesAwaitingApproval: developmentProjects.reduce((sum, project) => sum + project.awaitingApproval, 0),
      }}
      projects={developmentProjects}
      scopeLabel="Whole portfolio · all entities"
      scopeOptions={dashboardService.scopeOptions()}
      currentUserName={currentUser.name}
      currentUserRole={`${ROLE_LABELS[currentUser.role]} · MFA ${currentUser.mfa === 'on' ? 'on' : 'not required'}`}
      currentUserInitials={initialsOf(currentUser.name)}
      currentUserRoleLabel={ROLE_LABELS[currentUser.role]}
      personas={accessService.listUsers().flatMap((user) => {
        const note = PERSONA_NOTES[user.role];
        if (!note) return [];
        return [
          {
            userId: user.id,
            name: user.name,
            roleLabel: ROLE_LABELS[user.role],
            note,
            isCurrent: user.id === currentUser.id,
          },
        ];
      })}
      switchUserAction={switchUserAction}
      notifications={getNotifications(asOfDate)}
    >
      {children}
    </AppShell>
  );
}
