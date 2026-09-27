'use client';

import { useEffect } from 'react';

/**
 * Scroll the selected table row into view once, when a screen opens on a
 * record picked from global search (FR-09).
 *
 * `DataTable` marks the chosen row with `aria-selected="true"`, so this needs no
 * ref threaded through the table. Does nothing when `targetId` is absent.
 */
export function useScrollToSelectedRow(targetId: string | null | undefined): void {
  useEffect(() => {
    if (!targetId) return;
    const row = document.querySelector('tr[aria-selected="true"]');
    row?.scrollIntoView({ block: 'center' });
    if (row instanceof HTMLElement && row.tabIndex >= 0) row.focus({ preventScroll: true });
  }, [targetId]);
}
