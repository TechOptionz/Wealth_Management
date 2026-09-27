'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/shared/components/Icon';
import { TAB_FOR_VIEW, TAB_ITEMS, viewFromPathname } from '@/shared/config/navigation';
import { useNavigation } from './NavigationContext';

/**
 * Bottom tab bar, visible only at ≤840px. The "More" tab has no route of its
 * own — it opens the drawer holding the full grouped navigation.
 *
 * Every tab is a `<button>`, as in the prototype: the design's `.tabbar button`
 * rules (column layout, 10.5px label, gold active icon) match on the element
 * name, so a `<Link>` would render unstyled. Routed tabs navigate through the
 * router, and their routes are prefetched on mount so a tap is as quick as a
 * link would have been.
 */
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = TAB_FOR_VIEW[viewFromPathname(pathname)];
  const { openDrawer } = useNavigation();

  useEffect(() => {
    for (const tab of TAB_ITEMS) {
      if (tab.href !== null) router.prefetch(tab.href);
    }
  }, [router]);

  return (
    <nav className="tabbar" aria-label="Primary">
      {TAB_ITEMS.map((tab) => {
        const isCurrent = tab.key === activeTab;
        const { href } = tab;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            onClick={href === null ? openDrawer : () => router.push(href)}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
