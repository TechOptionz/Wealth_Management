'use client';

import { useEffect, useRef, useState } from 'react';

export interface TabsProps<TValue extends string> {
  readonly tabs: readonly { readonly value: TValue; readonly label: string }[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  readonly style?: React.CSSProperties;
}

/** Which edge of the strip still has tabs hidden beyond it. */
type ScrollEdge = 'none' | 'start' | 'middle' | 'end';

/**
 * Underlined tab strip. Scrolls horizontally on narrow screens.
 *
 * The strip reports its scroll position through `data-scroll`, which
 * `src/styles/mobile.css` turns into a fade on the overflowing edge, and it
 * scrolls the selected tab into view whenever the selection changes.
 */
export function Tabs<TValue extends string>({ tabs, value, onChange, style }: TabsProps<TValue>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<ScrollEdge>('none');

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    const measure = (): void => {
      const overflow = list.scrollWidth - list.clientWidth;
      if (overflow <= 1) {
        setEdge('none');
        return;
      }
      const left = list.scrollLeft;
      setEdge(left <= 1 ? 'start' : left >= overflow - 1 ? 'end' : 'middle');
    };

    measure();
    list.addEventListener('scroll', measure, { passive: true });
    // Re-measure when the strip's width changes — a rotation, a resized window.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [tabs.length]);

  // Skipped on mount so a page never jumps on load; on a change the tapped tab
  // is already on screen vertically, so only the strip scrolls.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <div
      ref={listRef}
      className="tabs"
      role="tablist"
      data-scroll={edge}
      style={{ WebkitOverflowScrolling: 'touch', ...style }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          className="tab"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
