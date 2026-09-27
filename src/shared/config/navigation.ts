/**
 * Navigation model — the single source of truth for the sidebar, the mobile tab
 * bar and page titles. Adding a feature screen means adding one entry here.
 *
 * Development Finance screens are **project scoped**: their `href` carries a
 * `[projectId]` placeholder that the sidebar fills from the current URL (or the
 * first project the person can open). The nine destinations keep the order the
 * requirements document fixes (§3.1): Cashflow, Summary, Invoices, Programme,
 * Yield, Finance, Scenarios, Reports, Assistant.
 */
import type { IconName } from '@/shared/components/IconSprite';

/** Stable key for a screen. Matches the module directory name where one exists. */
export type ViewKey =
  | 'dashboard'
  | 'obligations'
  | 'bank-import'
  | 'shared-bills'
  | 'expenses'
  | 'loans'
  | 'properties'
  | 'leases'
  | 'entities'
  | 'documents'
  | 'access'
  | 'design-system'
  | 'projects'
  | 'df-cashflow'
  | 'df-summary'
  | 'df-invoices'
  | 'df-programme'
  | 'df-yield'
  | 'df-finance'
  | 'df-scenarios'
  | 'df-reports'
  | 'df-assistant'
  | 'df-settings'
  | 'df-costs'
  | 'df-revenue';

export interface NavItem {
  readonly key: ViewKey;
  /** A path, or a pattern with `[projectId]` for a project-scoped screen. */
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** Sidebar group heading this item sits under. */
  readonly group: NavGroup;
  /**
   * Key of the count badge to display, resolved at render time from live data.
   * Undefined means the item never shows a badge.
   */
  readonly badge?: 'openObligations' | 'unmatchedTransactions' | 'billsNeedingReview' | 'invoicesAwaitingApproval';
  /** True when `href` contains `[projectId]`. */
  readonly projectScoped?: boolean;
}

export type NavGroup = 'Overview' | 'Money' | 'Property' | 'Development' | 'Records' | 'Admin';

export const NAV_GROUPS: readonly NavGroup[] = ['Overview', 'Money', 'Property', 'Development', 'Records', 'Admin'];

export const PROJECT_ID_PLACEHOLDER = '[projectId]';

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: 'i-home', group: 'Overview' },
  { key: 'obligations', href: '/obligations', label: 'Obligations & reminders', icon: 'i-check-sq', group: 'Overview', badge: 'openObligations' },
  { key: 'bank-import', href: '/bank-import', label: 'Bank import & matching', icon: 'i-wallet', group: 'Money', badge: 'unmatchedTransactions' },
  { key: 'shared-bills', href: '/shared-bills', label: 'Shared bills & recoveries', icon: 'i-users', group: 'Money', badge: 'billsNeedingReview' },
  { key: 'expenses', href: '/expenses', label: 'Expenses', icon: 'i-file', group: 'Money' },
  { key: 'loans', href: '/loans', label: 'Loans & liabilities', icon: 'i-calc', group: 'Money' },
  { key: 'properties', href: '/properties', label: 'Properties & assets', icon: 'i-building', group: 'Property' },
  { key: 'leases', href: '/leases', label: 'Leases & tenants', icon: 'i-users', group: 'Property' },
  { key: 'projects', href: '/projects', label: 'Projects', icon: 'i-grid', group: 'Development' },
  { key: 'df-cashflow', href: '/projects/[projectId]/cashflow', label: 'Cashflow', icon: 'i-calc', group: 'Development', projectScoped: true },
  { key: 'df-summary', href: '/projects/[projectId]/summary', label: 'Summary', icon: 'i-home', group: 'Development', projectScoped: true },
  { key: 'df-invoices', href: '/projects/[projectId]/invoices', label: 'Invoices', icon: 'i-file', group: 'Development', projectScoped: true, badge: 'invoicesAwaitingApproval' },
  { key: 'df-programme', href: '/projects/[projectId]/programme', label: 'Programme', icon: 'i-clock', group: 'Development', projectScoped: true },
  { key: 'df-yield', href: '/projects/[projectId]/yield', label: 'Yield', icon: 'i-building', group: 'Development', projectScoped: true },
  { key: 'df-finance', href: '/projects/[projectId]/finance', label: 'Finance', icon: 'i-wallet', group: 'Development', projectScoped: true },
  { key: 'df-scenarios', href: '/projects/[projectId]/scenarios', label: 'Scenarios', icon: 'i-link', group: 'Development', projectScoped: true },
  { key: 'df-reports', href: '/projects/[projectId]/reports', label: 'Reports', icon: 'i-upload', group: 'Development', projectScoped: true },
  { key: 'df-assistant', href: '/projects/[projectId]/assistant', label: 'Assistant', icon: 'i-search', group: 'Development', projectScoped: true },
  { key: 'entities', href: '/entities', label: 'Entities & ownership', icon: 'i-link', group: 'Records' },
  { key: 'documents', href: '/documents', label: 'Documents', icon: 'i-file', group: 'Records' },
  { key: 'access', href: '/access', label: 'Access & audit', icon: 'i-shield', group: 'Admin' },
  { key: 'design-system', href: '/design-system', label: 'Design system', icon: 'i-palette', group: 'Admin' },
];

/** Screens reachable from a project but not listed in the sidebar. */
const HIDDEN_VIEWS: readonly { readonly key: ViewKey; readonly href: string }[] = [
  { key: 'df-settings', href: '/projects/[projectId]/settings' },
  { key: 'df-costs', href: '/projects/[projectId]/costs' },
  { key: 'df-revenue', href: '/projects/[projectId]/revenue' },
];

/** Page titles shown in the top bar, keyed by view. */
export const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: 'Dashboard',
  obligations: 'Obligations & reminders',
  'bank-import': 'Bank import & matching',
  'shared-bills': 'Shared bills & recoveries',
  expenses: 'Expenses',
  loans: 'Loans & liabilities',
  properties: 'Properties & assets',
  leases: 'Leases & tenants',
  entities: 'Entities & ownership',
  documents: 'Documents',
  access: 'Access & audit',
  'design-system': 'Design system',
  projects: 'Development projects',
  'df-cashflow': 'Cashflow',
  'df-summary': 'Summary',
  'df-invoices': 'Invoices',
  'df-programme': 'Programme',
  'df-yield': 'Yield',
  'df-finance': 'Finance',
  'df-scenarios': 'Scenarios',
  'df-reports': 'Reports',
  'df-assistant': 'Assistant',
  'df-settings': 'Project settings',
  'df-costs': 'Cost register',
  'df-revenue': 'Revenue register',
};

/** The five bottom-bar destinations on mobile. `menu` opens the drawer. */
export type TabKey = 'dashboard' | 'bank-import' | 'properties' | 'obligations' | 'menu';

export interface TabItem {
  readonly key: TabKey;
  readonly href: string | null;
  readonly label: string;
  readonly icon: IconName;
}

export const TAB_ITEMS: readonly TabItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Home', icon: 'i-home' },
  { key: 'bank-import', href: '/bank-import', label: 'Money', icon: 'i-wallet' },
  { key: 'properties', href: '/properties', label: 'Property', icon: 'i-building' },
  { key: 'obligations', href: '/obligations', label: 'Tasks', icon: 'i-check-sq' },
  { key: 'menu', href: null, label: 'More', icon: 'i-grid' },
];

/**
 * Which bottom tab is highlighted for a given view. Screens without a tab of
 * their own light up "More", matching the prototype's `tabMap`.
 */
export const TAB_FOR_VIEW: Record<ViewKey, TabKey> = {
  dashboard: 'dashboard',
  'bank-import': 'bank-import',
  'shared-bills': 'bank-import',
  expenses: 'bank-import',
  loans: 'bank-import',
  properties: 'properties',
  leases: 'properties',
  obligations: 'obligations',
  entities: 'menu',
  documents: 'menu',
  access: 'menu',
  'design-system': 'menu',
  projects: 'menu',
  'df-cashflow': 'menu',
  'df-summary': 'menu',
  'df-invoices': 'menu',
  'df-programme': 'menu',
  'df-yield': 'menu',
  'df-finance': 'menu',
  'df-scenarios': 'menu',
  'df-reports': 'menu',
  'df-assistant': 'menu',
  'df-settings': 'menu',
  'df-costs': 'menu',
  'df-revenue': 'menu',
};

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|\\]/g, '\\$&').replace('\\[projectId\\]', '[^/]+').replace('[projectId]', '[^/]+');
  return new RegExp(`^${escaped}(?:/|$)`);
}

/** Fill a scoped `href` with a project id. Unscoped items are returned as-is. */
export function resolveNavHref(item: Pick<NavItem, 'href' | 'projectScoped'>, projectId: string | null): string {
  if (!item.projectScoped) return item.href;
  if (!projectId) return '/projects';
  return item.href.replace(PROJECT_ID_PLACEHOLDER, encodeURIComponent(projectId));
}

/** The project id inside a `/projects/{id}/…` pathname, or null. */
export function projectIdFromPathname(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

/**
 * Resolve the active view from a pathname. Defaults to the dashboard. More
 * specific patterns win, so `/projects/x/cashflow` is Cashflow, not Projects.
 */
export function viewFromPathname(pathname: string): ViewKey {
  const candidates = [...NAV_ITEMS.map((item) => ({ key: item.key, href: item.href })), ...HIDDEN_VIEWS].sort(
    (a, b) => b.href.length - a.href.length,
  );
  const match = candidates.find((item) => patternToRegex(item.href).test(pathname));
  return match?.key ?? 'dashboard';
}
