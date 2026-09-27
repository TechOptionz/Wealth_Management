'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/shared/components/Icon';
import { APP_NAME, APP_TAGLINE } from '@/shared/config/app-config';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  projectIdFromPathname,
  resolveNavHref,
  viewFromPathname,
  type NavItem,
} from '@/shared/config/navigation';
import { useNavigation } from './NavigationContext';
import { ScopePicker } from './ScopePicker';

export interface ProjectNavChild {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface ProjectNavEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Revenue groups and cost categories become the expandable children (§3.1). */
  readonly revenue: readonly ProjectNavChild[];
  readonly costs: readonly ProjectNavChild[];
}

export interface SidebarProps {
  /** Live counts for nav badges, resolved on the server and passed down. */
  readonly badges: {
    readonly openObligations: number;
    readonly unmatchedTransactions: number;
    readonly billsNeedingReview: number;
    readonly invoicesAwaitingApproval: number;
  };
  /** Current scope label shown in the scope pill. */
  readonly scopeLabel: string;
  /**
   * Entities the dashboard can be scoped to. When the URL carries a matching
   * `?entityId=`, the pill shows that entity instead of `scopeLabel`.
   */
  readonly scopeOptions?: readonly { readonly entityId: string; readonly entityName: string }[];
  /** Development projects the person may open, with their nav children. */
  readonly projects?: readonly ProjectNavEntry[];
  readonly currentUserName: string;
  readonly currentUserRole: string;
}

export function Sidebar({ badges, scopeLabel, scopeOptions, projects = [], currentUserName, currentUserRole }: SidebarProps) {
  const pathname = usePathname();
  const activeView = viewFromPathname(pathname);
  const { isDrawerOpen, closeDrawer } = useNavigation();
  const [openGroup, setOpenGroup] = useState<'revenue' | 'costs' | null>(null);

  const pathProjectId = projectIdFromPathname(pathname);
  const currentProject = projects.find((project) => project.id === pathProjectId) ?? projects[0] ?? null;
  const onProject = pathProjectId !== null && currentProject?.id === pathProjectId;

  const initials = currentUserName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const renderItem = (item: NavItem) => {
    const count = item.badge ? badges[item.badge] : undefined;
    const href = resolveNavHref(item, currentProject?.id ?? null);
    return (
      <Link
        key={item.key}
        href={href}
        className="nav-item"
        aria-current={item.key === activeView ? 'page' : undefined}
        onClick={closeDrawer}
      >
        <Icon name={item.icon} />
        {item.label}
        {count ? <span className="count">{count}</span> : null}
      </Link>
    );
  };

  const renderChildren = (group: 'revenue' | 'costs', children: readonly ProjectNavChild[]) => {
    const expanded = openGroup === group;
    const listId = `nav-${group}`;
    return (
      <div key={group}>
        <button
          type="button"
          className="nav-item nav-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpenGroup(expanded ? null : group)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
            <Icon name={group === 'revenue' ? 'i-up' : 'i-down'} />
            {group === 'revenue' ? 'Revenue' : 'Costs'}
          </span>
          <Icon name="i-chev" size={14} />
        </button>
        <div id={listId} hidden={!expanded}>
          {children.length === 0 ? (
            <span className="nav-item nav-sub" style={{ color: 'var(--on-ink-muted)' }}>
              None yet
            </span>
          ) : (
            children.map((child) => (
              <Link
                key={child.id}
                href={child.href}
                className="nav-item nav-sub"
                aria-current={pathname === child.href ? 'page' : undefined}
                onClick={closeDrawer}
              >
                {child.label}
              </Link>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className={isDrawerOpen ? 'sidebar open' : 'sidebar'} id="sidebar" aria-label="Main navigation">
      <div className="brand">
        <div className="brand-mark">{APP_NAME.charAt(0)}</div>
        <div>
          <div className="brand-name">{APP_NAME}</div>
          <span className="brand-sub">{APP_TAGLINE}</span>
        </div>
      </div>

      {/* `ScopePicker` reads the URL, so it must sit under a Suspense boundary. */}
      <Suspense
        fallback={
          <button className="scope" title="Change scope (entity, property, period)" type="button" disabled>
            <div>
              <small>Viewing</small>
              <strong>{scopeLabel}</strong>
            </div>
            <Icon name="i-chev-ud" />
          </button>
        }
      >
        <ScopePicker allLabel={scopeLabel} options={scopeOptions ?? []} onNavigate={closeDrawer} />
      </Suspense>

      <nav className="nav">
        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group);
          if (group === 'Development') {
            const [projectsItem, ...scoped] = items;
            return (
              <div key={group}>
                <div className="nav-group">
                  {group}
                  {currentProject ? ` · ${currentProject.code}` : ''}
                </div>
                {projectsItem ? renderItem(projectsItem) : null}
                {currentProject ? (
                  <>
                    {scoped.map(renderItem)}
                    {onProject ? renderChildren('revenue', currentProject.revenue) : null}
                    {onProject ? renderChildren('costs', currentProject.costs) : null}
                  </>
                ) : null}
              </div>
            );
          }
          return (
            <div key={group}>
              <div className="nav-group">{group}</div>
              {items.map(renderItem)}
            </div>
          );
        })}
      </nav>

      <div className="side-foot">
        <div className="avatar">{initials}</div>
        <div>
          <div>{currentUserName}</div>
          <span className="role">{currentUserRole}</span>
        </div>
      </div>
    </aside>
  );
}
