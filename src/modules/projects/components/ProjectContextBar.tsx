'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Chip } from '@/shared/components/Chip';
import type { IconName } from '@/shared/components/IconSprite';
import type { Tone } from '@/shared/types/common';
import { LIFECYCLE_LABELS, TAX_DISPLAY_LABELS, type ProjectLifecycle, type TaxDisplayBasis } from '../model';

export interface ProjectContextBarProps {
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly lifecycle: ProjectLifecycle;
  readonly currency: string;
  readonly modelRevision: number;
  readonly policyVersion: number;
  readonly actualsCutoff: string;
  readonly displayBasis: TaxDisplayBasis;
  /** "Run #12 · 3 min ago · engine 1.0.0", or null before a calculation has been published. */
  readonly freshnessLabel: string | null;
  readonly scenarioLabel: string;
  readonly canEditSettings: boolean;
}

const LIFECYCLE_TONE: Record<ProjectLifecycle, { tone: Tone; icon: IconName }> = {
  draft: { tone: 'neutral', icon: 'i-clock' },
  active: { tone: 'good', icon: 'i-check' },
  paused: { tone: 'warn', icon: 'i-pause' },
  completed: { tone: 'info', icon: 'i-check-sq' },
  archived: { tone: 'neutral', icon: 'i-x' },
};

/**
 * The facts §3.3 puts in the top bar: organisation, project, scenario, model
 * version, currency, tax display basis, data freshness. Rendered inside the
 * content region so the shared shell stays untouched. The basis toggle is a
 * link that rewrites `?basis=` — presentation only, never a recalculation
 * (CAL09).
 */
export function ProjectContextBar(props: ProjectContextBarProps) {
  return (
    <Suspense fallback={<ContextBarBody {...props} basisHref={() => '#'} />}>
      <ContextBarWithSearch {...props} />
    </Suspense>
  );
}

function ContextBarWithSearch(props: ProjectContextBarProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const basisHref = (basis: TaxDisplayBasis): string => {
    const next = new URLSearchParams(params.toString());
    next.set('basis', basis);
    return `${pathname}?${next.toString()}`;
  };
  const requested = params.get('basis');
  const effective: TaxDisplayBasis = requested === 'gross' || requested === 'economic' ? requested : props.displayBasis;
  return <ContextBarBody {...props} displayBasis={effective} basisHref={basisHref} />;
}

function ContextBarBody({
  projectId,
  code,
  name,
  lifecycle,
  currency,
  modelRevision,
  policyVersion,
  actualsCutoff,
  displayBasis,
  freshnessLabel,
  scenarioLabel,
  canEditSettings,
  basisHref,
}: ProjectContextBarProps & { readonly basisHref: (basis: TaxDisplayBasis) => string }) {
  const chip = LIFECYCLE_TONE[lifecycle];
  const otherBasis: TaxDisplayBasis = displayBasis === 'economic' ? 'gross' : 'economic';
  return (
    <div className="ctx-bar" role="region" aria-label="Project context">
      <span>
        <b>{code}</b> · {name}
      </span>
      <Chip tone={chip.tone} icon={chip.icon}>
        {LIFECYCLE_LABELS[lifecycle]}
      </Chip>
      <span className="ctx-sep" aria-hidden="true" />
      <span>
        Scenario <b>{scenarioLabel}</b>
      </span>
      <span>
        Model <b>rev {modelRevision}</b> · policy v{policyVersion}
      </span>
      <span>
        Actuals to <b>{actualsCutoff}</b>
      </span>
      <span>
        <b>{currency}</b>
      </span>
      <span title={TAX_DISPLAY_LABELS[displayBasis]}>
        Showing <b>{displayBasis === 'economic' ? 'economic (net of recoverable GST)' : 'gross (cash incl. GST)'}</b> ·{' '}
        <Link href={basisHref(otherBasis)}>switch to {otherBasis}</Link>
      </span>
      <span>{freshnessLabel ? <>Calculated <b>{freshnessLabel}</b></> : <b>Not yet calculated</b>}</span>
      <Chip tone="neutral" icon="i-link">
        Accounting: not connected
      </Chip>
      <span className="ctx-actions">
        {canEditSettings ? (
          <Link className="btn sm" href={`/projects/${encodeURIComponent(projectId)}/settings`}>
            Settings
          </Link>
        ) : null}
      </span>
    </div>
  );
}
