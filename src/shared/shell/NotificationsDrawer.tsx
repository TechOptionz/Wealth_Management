'use client';

import Link from 'next/link';
import { Chip } from '@/shared/components/Chip';
import { Icon } from '@/shared/components/Icon';
import type { IconName } from '@/shared/components/IconSprite';
import { formatDateShort } from '@/shared/lib/dates';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_GROUP_LABELS,
  type NotificationItem,
  type NotificationTone,
} from '@/shared/types/notifications';

/** Status is never colour alone: each tone carries an icon and a word. */
const TONE_BADGES: Record<NotificationTone, { readonly icon: IconName; readonly label: string }> = {
  bad: { icon: 'i-alert', label: 'Overdue' },
  warn: { icon: 'i-clock', label: 'Due soon' },
  info: { icon: 'i-wallet', label: 'Reminder' },
};

export interface NotificationsDrawerProps {
  readonly id: string;
  readonly isOpen: boolean;
  readonly items: readonly NotificationItem[];
  readonly readIds: ReadonlySet<string>;
  readonly onMarkAllRead: () => void;
  readonly onClose: () => void;
}

/**
 * The panel under the top bar's bell. Presentation only — `TopBar` owns the
 * open and read state, and the items arrive already permission-filtered.
 */
export function NotificationsDrawer({ id, isOpen, items, readIds, onMarkAllRead, onClose }: NotificationsDrawerProps) {
  const unreadCount = items.filter((item) => !readIds.has(item.id)).length;

  return (
    <div
      id={id}
      // `.card` is the surface, radius and shadow; `.pop` (src/styles/mobile.css)
      // anchors it under the bell and, below 840px, pins it to the viewport so
      // it never clips off a narrow screen.
      className="card pop"
      role="region"
      aria-label="Notifications"
      hidden={!isOpen}
    >
      <div className="card-h">
        <h3>Notifications</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn ghost sm" type="button" disabled={unreadCount === 0} onClick={onMarkAllRead}>
            Mark all read
          </button>
          <button className="icon-btn" type="button" aria-label="Close notifications" onClick={onClose}>
            <Icon name="i-x" />
          </button>
        </div>
      </div>

      {NOTIFICATION_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        const headingId = `${id}-${group}`;
        return (
          <ul key={group} className="list" aria-labelledby={headingId}>
            <li>
              <div className="li-main">
                <span id={headingId}>{NOTIFICATION_GROUP_LABELS[group]}</span>
              </div>
              <Chip>{groupItems.length}</Chip>
            </li>
            {groupItems.map((item) => {
              const badge = TONE_BADGES[item.tone];
              const isUnread = !readIds.has(item.id);
              return (
                <li key={item.id} style={{ padding: 0 }}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 18px', flex: 1, minWidth: 0 }}
                  >
                    <div className="li-main">
                      <b style={{ whiteSpace: 'normal' }}>{item.title}</b>
                      <span style={{ whiteSpace: 'normal' }}>{item.description}</span>
                      <span>
                        {formatDateShort(item.timestamp)}
                        {isUnread ? ' · New' : ''}
                      </span>
                    </div>
                    <Chip tone={item.tone} icon={badge.icon}>
                      {badge.label}
                    </Chip>
                  </Link>
                </li>
              );
            })}
          </ul>
        );
      })}

      {items.length === 0 ? <div className="card-b sub">You&rsquo;re all caught up · nothing needs attention.</div> : null}
    </div>
  );
}
