'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Chip } from '@/shared/components/Chip';
import { Icon } from '@/shared/components/Icon';
import type { IconName } from '@/shared/components/IconSprite';
import type { SearchCategory, SearchResult, SearchResults } from '@/shared/types/search';

const DEBOUNCE_MS = 200;

/** Mirrors the server's minimum, so a one-letter query never leaves the browser. */
const MIN_QUERY_LENGTH = 2;

/** Same icons the sidebar uses for each screen. */
const CATEGORY_ICONS: Record<SearchCategory, IconName> = {
  properties: 'i-building',
  tenants: 'i-users',
  obligations: 'i-check-sq',
  loans: 'i-calc',
  documents: 'i-file',
};

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface GlobalSearchProps {
  /** Focus the input as soon as it mounts — the mobile sheet opens straight into typing. */
  readonly autoFocus?: boolean;
  /**
   * Called when the person is done here: a result was chosen, or Escape was
   * pressed with the menu already closed. The mobile search sheet uses it to
   * close itself; the desktop bar has no need of it.
   */
  readonly onDismiss?: () => void;
}

/**
 * Top-bar global search (FR-09).
 *
 * An ARIA combobox: focus stays in the input and `aria-activedescendant` points
 * at the highlighted option, so arrow keys, Enter and Escape work without the
 * user ever leaving the field. Presentation only — matching and permission
 * filtering happen behind `/api/search`.
 *
 * Rendered twice by the shell: in the top bar (hidden by the design below
 * 840px) and inside the mobile search sheet that replaces it there.
 */
export function GlobalSearch({ autoFocus = false, onDismiss }: GlobalSearchProps = {}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SearchStatus>('idle');
  // Kept while the next request is in flight, so the menu does not flicker
  // empty between keystrokes.
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const listId = useId();

  const groups = results?.groups ?? [];
  const options: readonly SearchResult[] = groups.flatMap((group) => group.results);
  /** Index of each group's first option in the flat, keyboard-navigable list. */
  const groupStarts = groups.map((_, position) =>
    groups.slice(0, position).reduce((count, group) => count + group.results.length, 0),
  );
  const optionId = (index: number): string => `${listId}-option-${index}`;

  const cancelPending = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current?.abort();
    timerRef.current = null;
    requestRef.current = null;
  };

  useEffect(() => cancelPending, []);

  // Keep the keyboard-highlighted option in view inside the scrolling menu.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${listId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listId]);

  const runSearch = async (term: string): Promise<void> => {
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Search failed with ${response.status}`);
      const body = (await response.json()) as { readonly data: SearchResults };
      setResults(body.data);
      setStatus('ready');
    } catch {
      // An aborted request was superseded by newer typing — not a failure.
      if (controller.signal.aborted) return;
      setResults(null);
      setStatus('error');
    }
  };

  const handleChange = (value: string): void => {
    setQuery(value);
    setActiveIndex(-1);
    cancelPending();

    const term = value.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      setStatus('idle');
      setResults(null);
      setIsOpen(false);
      return;
    }
    setStatus('loading');
    setIsOpen(true);
    timerRef.current = setTimeout(() => void runSearch(term), DEBOUNCE_MS);
  };

  const close = (): void => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const choose = (result: SearchResult): void => {
    cancelPending();
    setQuery('');
    setStatus('idle');
    setResults(null);
    close();
    inputRef.current?.blur();
    router.push(result.href);
    onDismiss?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (options.length === 0) return;
        event.preventDefault();
        setIsOpen(true);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        // From "nothing highlighted", Down lands on the first and Up on the last.
        setActiveIndex((current) =>
          current < 0 ? (step === 1 ? 0 : options.length - 1) : (current + step + options.length) % options.length,
        );
        return;
      }
      case 'Enter': {
        // Enter with nothing highlighted takes the top result.
        const chosen = isOpen ? options[Math.max(activeIndex, 0)] : undefined;
        if (!chosen) return;
        event.preventDefault();
        choose(chosen);
        return;
      }
      case 'Escape': {
        // First Escape dismisses the menu; a second hands back to the host
        // (the mobile sheet closes) or, in the bare top bar, clears the field.
        if (isOpen) {
          event.preventDefault();
          close();
          return;
        }
        if (onDismiss) {
          event.preventDefault();
          onDismiss();
          return;
        }
        if (query === '') return;
        event.preventDefault();
        handleChange('');
        return;
      }
      default:
    }
  };

  const trimmed = query.trim();

  return (
    <div
      ref={rootRef}
      className="search"
      style={{ position: 'relative' }}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) close();
      }}
    >
      <Icon name="i-search" />
      <input
        ref={inputRef}
        value={query}
        placeholder="Search properties, tenants, documents…"
        aria-label="Search"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        spellCheck={false}
        // Only the mobile sheet sets this: it exists to be typed into and opened on a tap.
        autoFocus={autoFocus}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => {
          if (status !== 'idle') setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      <div
        // `.card` is the surface; `.pop` (src/styles/mobile.css) anchors the
        // menu under the field and, below 840px, pins it full-width under the sheet.
        className="card pop results"
        hidden={!isOpen}
        // Keep focus in the input so a click never blurs the combobox closed.
        onMouseDown={(event) => event.preventDefault()}
      >
        <div id={listId} role="listbox" aria-label="Search results">
          {groups.map((group, groupPosition) => {
            const start = groupStarts[groupPosition] ?? 0;
            const headingId = `${listId}-${group.category}`;
            return (
              <ul key={group.category} className="list" role="group" aria-labelledby={headingId}>
                <li role="presentation">
                  <div className="li-main">
                    <span id={headingId}>{group.label}</span>
                  </div>
                  <Chip>
                    {group.total > group.results.length
                      ? `${group.results.length} of ${group.total}`
                      : group.total}
                  </Chip>
                </li>
                {group.results.map((result, position) => {
                  const index = start + position;
                  const isActive = index === activeIndex;
                  return (
                    <li
                      key={result.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      style={{ cursor: 'pointer', background: isActive ? 'var(--surface-2)' : undefined }}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => choose(result)}
                    >
                      <Icon name={CATEGORY_ICONS[result.category]} />
                      <div className="li-main">
                        <b>{result.title}</b>
                        <span>{result.subtitle}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            );
          })}
        </div>

        {/* Announced politely, so a screen reader hears the outcome of each search. */}
        <div className="card-b sub" role="status" hidden={options.length > 0}>
          {status === 'loading' ? 'Searching…' : null}
          {status === 'error' ? 'Search is unavailable right now. Try again.' : null}
          {status === 'ready' && options.length === 0 ? `No matches for “${trimmed}”.` : null}
        </div>
      </div>
    </div>
  );
}
