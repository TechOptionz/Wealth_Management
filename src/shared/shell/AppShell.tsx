import type { ReactNode } from 'react';
import { IconSprite } from '@/shared/components/IconSprite';
import { NavigationProvider } from './NavigationContext';
import { ToastProvider } from './ToastContext';
import { Sidebar, type SidebarProps } from './Sidebar';
import { TopBar, type TopBarProps } from './TopBar';
import { TabBar } from './TabBar';
import { Scrim } from './Scrim';

export interface AppShellProps extends SidebarProps, TopBarProps {
  readonly children: ReactNode;
}

/**
 * The application chrome: sidebar, top bar, content region and mobile tab bar.
 *
 * Structure mirrors the design prototype exactly — `.app > .sidebar + .scrim +
 * .main > .topbar + .content`, with the tab bar as the last child of `.app`.
 * Each routed page renders inside `.view.active` so page-level styling matches.
 */
export function AppShell({
  children,
  badges,
  scopeLabel,
  scopeOptions,
  projects,
  currentUserName,
  currentUserRole,
  asOfDate,
  notifications,
  currentUserInitials,
  currentUserRoleLabel,
  personas,
  switchUserAction,
}: AppShellProps) {
  return (
    <NavigationProvider>
      <ToastProvider>
        <IconSprite />
        <div className="app">
          <Sidebar
            badges={badges}
            scopeLabel={scopeLabel}
            scopeOptions={scopeOptions}
            projects={projects}
            currentUserName={currentUserName}
            currentUserRole={currentUserRole}
          />
          <Scrim />

          <div className="main">
            <TopBar
              asOfDate={asOfDate}
              notifications={notifications}
              currentUserInitials={currentUserInitials}
              currentUserName={currentUserName}
              currentUserRoleLabel={currentUserRoleLabel}
              personas={personas}
              switchUserAction={switchUserAction}
            />
            <div className="content">
              <section className="view active">{children}</section>
            </div>
          </div>

          <TabBar />
        </div>
      </ToastProvider>
    </NavigationProvider>
  );
}
