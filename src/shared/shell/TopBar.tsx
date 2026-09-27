'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Icon } from '@/shared/components/Icon';
import { VIEW_TITLES, viewFromPathname } from '@/shared/config/navigation';
import { formatDateLong } from '@/shared/lib/dates';
import { BASE_CURRENCY } from '@/shared/config/app-config';
import type { IsoDate } from '@/shared/types/common';
import type { NotificationItem } from '@/shared/types/notifications';
import { GlobalSearch } from './GlobalSearch';
import { useNavigation } from './NavigationContext';
import { NotificationsDrawer } from './NotificationsDrawer';
import { UserMenu, type SwitchUserAction, type UserMenuPersona } from './UserMenu';

export interface TopBarProps {
  readonly asOfDate: IsoDate;
  /** Already permission-filtered on the server; the shell only renders them. */
  readonly notifications: readonly NotificationItem[];
  readonly currentUserInitials: string;
  readonly currentUserName: string;
  /** The bare role name for the account menu chip, e.g. "Portfolio owner". */
  readonly currentUserRoleLabel: string;
  readonly personas: readonly UserMenuPersona[];
  readonly switchUserAction: SwitchUserAction;
}

export function TopBar({
  asOfDate,
  notifications,
  currentUserInitials,
  currentUserName,
  currentUserRoleLabel,
  personas,
  switchUserAction,
}: TopBarProps) {
  const pathname = usePathname();
  const { isDrawerOpen, toggleDrawer } = useNavigation();
  const title = VIEW_TITLES[viewFromPathname(pathname)];

  const [isOpen, setIsOpen] = useState(false);
  // Held in memory only: a reload brings back anything still unresolved.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
  const bellRootRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const unreadNotifications = notifications.filter((item) => !readIds.has(item.id)).length;

  // Mobile search sheet. The design hides `.search` below 840px; the toggle and
  // sheet exist only there (see `.search-toggle` in src/styles/mobile.css).
  const [isSearchOpen, setSearchOpen] = useState(false);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const closeSearch = (): void => {
    setSearchOpen(false);
    searchToggleRef.current?.focus();
  };
  const onSheetKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // The input handles its own Escape; this catches it on the close button.
    if (event.key === 'Escape' && !event.defaultPrevented) closeSearch();
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      bellRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!bellRootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen]);

  return (
    <header className="topbar">
      <button
        className="menu-btn"
        id="menuBtn"
        aria-label="Open navigation"
        aria-controls="sidebar"
        aria-expanded={isDrawerOpen}
        onClick={toggleDrawer}
        type="button"
      >
        <Icon name="i-menu" />
      </button>

      <h1 className="page-title" id="pageTitle">
        {title}
      </h1>

      <div className="asof">
        <Icon name="i-clock" size={14} />
        As of <b>{formatDateLong(asOfDate)}</b> · {BASE_CURRENCY}
      </div>

      <GlobalSearch />

      <button
        ref={searchToggleRef}
        className="icon-btn search-toggle"
        aria-label="Search"
        aria-expanded={isSearchOpen}
        onClick={() => setSearchOpen(true)}
        type="button"
      >
        <Icon name="i-search" />
      </button>

      {/* Portalled so the scrim and sheet sit above the sidebar and tab bar,
          outside the sticky top bar's stacking context. Only ever opened by a
          click, so `document` always exists here. */}
      {isSearchOpen
        ? createPortal(
            <>
              <div className="scrim show search-scrim" aria-hidden="true" onClick={closeSearch} />
              <div className="search-sheet" role="dialog" aria-label="Search" onKeyDown={onSheetKeyDown}>
                <GlobalSearch autoFocus onDismiss={closeSearch} />
                <button className="icon-btn" type="button" aria-label="Close search" onClick={closeSearch}>
                  <Icon name="i-x" />
                </button>
              </div>
            </>,
            document.body,
          )
        : null}

      <div ref={bellRootRef} style={{ position: 'relative' }}>
        <button
          ref={bellRef}
          className="icon-btn"
          aria-label={`Notifications, ${unreadNotifications} unread`}
          aria-expanded={isOpen}
          aria-controls={drawerId}
          onClick={() => setIsOpen((open) => !open)}
          type="button"
        >
          <Icon name="i-bell" />
          {unreadNotifications > 0 ? <span className="dot" /> : null}
        </button>

        <NotificationsDrawer
          id={drawerId}
          isOpen={isOpen}
          items={notifications}
          readIds={readIds}
          onMarkAllRead={() => setReadIds(new Set(notifications.map((item) => item.id)))}
          onClose={() => setIsOpen(false)}
        />
      </div>

      <UserMenu
        currentUserName={currentUserName}
        currentUserRoleLabel={currentUserRoleLabel}
        currentUserInitials={currentUserInitials}
        personas={personas}
        switchUserAction={switchUserAction}
      />
    </header>
  );
}
