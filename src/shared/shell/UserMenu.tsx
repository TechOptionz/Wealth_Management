'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Chip } from '@/shared/components/Chip';
import { Icon } from '@/shared/components/Icon';
import { IDLE_RESULT, type ActionResult } from '@/shared/lib/action-result';
import { useToast } from './ToastContext';

export interface UserMenuPersona {
  readonly userId: string;
  readonly name: string;
  readonly roleLabel: string;
  /** What this persona can and cannot see, e.g. "Assigned properties only · no net worth". */
  readonly note: string;
  readonly isCurrent: boolean;
}

export type SwitchUserAction = (previous: ActionResult<unknown>, form: FormData) => Promise<ActionResult<unknown>>;

export interface UserMenuProps {
  readonly currentUserName: string;
  readonly currentUserRoleLabel: string;
  readonly currentUserInitials: string;
  readonly personas: readonly UserMenuPersona[];
  /** Passed in by the layout so the shell does not import a feature module. */
  readonly switchUserAction: SwitchUserAction;
}

/**
 * Top bar account menu with the test-persona switcher (NFR-01 testing aid).
 *
 * A disclosure like `ScopePicker`: the avatar toggles a small card. Each persona
 * is a submit button in one form, so switching works through the Server Action
 * and the server re-renders everything for the new user.
 */
export function UserMenu({
  currentUserName,
  currentUserRoleLabel,
  currentUserInitials,
  personas,
  switchUserAction,
}: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [result, formAction, isPending] = useActionState(switchUserAction, IDLE_RESULT);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { toast } = useToast();

  useEffect(() => {
    if (!result.message) return;
    toast(result.message);
    if (result.ok) setIsOpen(false);
  }, [result, toast]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen]);

  return (
    // Shown at every width: a tester on a phone must be able to switch persona
    // (FR-01 / NFR-01), and the drawer footer only *names* the current user.
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        aria-label={`Account · ${currentUserName}, ${currentUserRoleLabel}`}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
          {currentUserInitials}
        </div>
      </button>

      {/* `.pop` (src/styles/mobile.css) anchors the card under the avatar and,
          below 840px, pins it to the viewport so a 360px screen never clips it. */}
      <div id={menuId} className="card pop account" hidden={!isOpen}>
        <div className="card-h">
          <h3>{currentUserName}</h3>
          <Chip tone="gold" icon="i-users">
            {currentUserRoleLabel}
          </Chip>
        </div>

        <form action={formAction} className="card-b" style={{ display: 'grid', gap: 4 }}>
          <div className="sub" style={{ fontSize: 12, marginBottom: 4 }}>
            Test personas · switch to check permissions
          </div>
          {personas.map((persona) => (
            <button
              key={persona.userId}
              className="btn ghost"
              name="userId"
              value={persona.userId}
              type="submit"
              aria-pressed={persona.isCurrent}
              disabled={isPending || persona.isCurrent}
              style={{ height: 'auto', padding: '8px 10px', justifyContent: 'space-between', whiteSpace: 'normal', textAlign: 'left' }}
            >
              <span>
                <span style={{ display: 'block' }}>
                  {persona.name} · {persona.roleLabel}
                </span>
                <span className="sub" style={{ display: 'block', fontSize: 12 }}>
                  {persona.note}
                </span>
              </span>
              {/* `aria-pressed` carries the state; the tick keeps it from being colour alone. */}
              {persona.isCurrent ? <Icon name="i-check" size={14} /> : null}
            </button>
          ))}
        </form>
      </div>
    </div>
  );
}
