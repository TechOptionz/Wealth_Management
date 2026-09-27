import type { Metadata } from 'next';
import { loadUnitOfWork } from '@/server/db/unit-of-work';
import { renderGuarded } from '@/shared/components/AccessDenied';
import { resolveAsOfDate } from '@/shared/config/app-config';
import { formatPpmAsPercent } from '@/shared/finance-engine';
import { accessService } from '@/modules/access/service';
import { projectsApi } from '@/modules/projects/api';
import { projectsService } from '@/modules/projects/service';
import { TAX_DISPLAY_LABELS } from '@/modules/projects/model';
import { ProjectSettingsScreen, type MemberRow, type PolicyRow } from '@/modules/projects/components/ProjectSettingsScreen';
import { fundingService } from '@/modules/funding/service';
import { asId } from '@/shared/types/common';

export const metadata: Metadata = { title: 'Project settings · Holdfast' };

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/** PRJ01–PRJ05, IAM03–IAM04, CF06 — identity, setup, policy, members and lifecycle. */
export default async function ProjectSettingsPage({ params }: PageProps) {
  await loadUnitOfWork();
  const { projectId } = await params;
  const today = resolveAsOfDate();

  return renderGuarded(() => {
    const summary = projectsApi.get(projectId);
    const { project, scope, activationBlockers } = summary;
    const canManageMembers = scope.permissions.includes('members.manage');

    const policies: readonly PolicyRow[] = projectsService.policyHistory(project.id).map((policy) => {
      const twoPerson = policy.approval.steps.find((step) => step.approversRequired >= 2);
      return {
        version: policy.version,
        effectiveFrom: policy.effectiveFrom,
        reason: policy.reason,
        actualsCutoff: policy.actualsCutoff,
        standardRateLabel: formatPpmAsPercent(policy.tax.standardRatePpm),
        displayBasis: TAX_DISPLAY_LABELS[policy.tax.displayBasis],
        minimumReserve: policy.funding.minimumReserve,
        twoPersonThreshold: twoPerson ? twoPerson.minimumGross : null,
        createdByName: accessService.resolveUserName(policy.createdBy) ?? 'system',
      };
    });

    const members: readonly MemberRow[] = canManageMembers
      ? projectsService.listMembers(project.id).map((row) => ({
          accessId: row.id,
          userId: row.userId,
          name: accessService.resolveUserName(row.userId) ?? 'Unknown',
          role: row.role,
          grants: row.grants,
          approvalLimit: row.approvalLimit,
          status: row.status,
          expiresAt: row.expiresAt ?? null,
        }))
      : [];

    return (
      <ProjectSettingsScreen
        project={{
          id: project.id,
          code: project.code,
          name: project.name,
          type: project.type,
          address: project.address,
          state: project.state,
          lifecycle: project.lifecycle,
          lifecycleReason: project.lifecycleReason ?? null,
          startDate: project.startDate,
          expectedCompletion: project.expectedCompletion,
          forecastHorizonMonths: project.forecastHorizonMonths,
          reportingBasis: project.reportingBasis,
          modelRevision: project.modelRevision,
          openingCash: project.openingCash,
          openingRestrictedCash: project.openingRestrictedCash,
          setupStepsCompleted: project.setupStepsCompleted,
          legalEntityName: projectsService.requireLegalEntity(project.legalEntityId).legalName,
        }}
        activationBlockers={activationBlockers}
        policies={policies}
        members={members}
        people={accessService.listUsers().map((user) => ({ id: user.id, name: user.name }))}
        participants={fundingService.listParticipants(asId<'Project'>(projectId)).map((participant) => ({ id: participant.id, name: participant.name }))}
        permissions={{
          canEdit: scope.permissions.includes('project.edit'),
          canManageMembers,
          canReopen: scope.permissions.includes('period.reopen'),
        }}
        today={today}
      />
    );
  });
}
