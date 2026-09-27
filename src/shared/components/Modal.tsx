'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface ModalProps {
  readonly title: ReactNode;
  /** Muted line under the title — a reference, a date. */
  readonly subtitle?: ReactNode;
  /** Called when the dialog is dismissed: the close button, Escape, or a click on the backdrop. */
  readonly onClose: () => void;
  /** Footer buttons. Hidden when the page is printed. */
  readonly actions?: ReactNode;
  /** Widens the panel for tables. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/**
 * A native `<dialog>` shown in the browser's top layer.
 *
 * Rendered into `document.body` through a portal so the print stylesheet can
 * hide everything else and print only the open dialog. The browser supplies
 * focus trapping, Escape handling and focus return to the opener; the surface,
 * header and body reuse the design's `.card` markup. Styling lives in
 * `src/styles/modal.css`, the one stylesheet outside the verbatim design port.
 */
export function Modal({ title, subtitle, onClose, actions, wide = false, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  // A portal needs `document`, which a server render does not have.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className={wide ? 'modal card wide' : 'modal card'}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // The backdrop belongs to the dialog element itself; content clicks land on a child.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card-h">
        <div style={{ minWidth: 0 }}>
          <h3 id={titleId}>{title}</h3>
          {subtitle ? (
            <span className="sub" style={{ display: 'block', fontSize: 12.5 }}>
              {subtitle}
            </span>
          ) : null}
        </div>
        <button className="icon-btn no-print" type="button" aria-label="Close" onClick={onClose}>
          <Icon name="i-x" />
        </button>
      </div>
      <div className="card-b">{children}</div>
      {actions ? <div className="modal-foot no-print">{actions}</div> : null}
    </dialog>,
    document.body,
  );
}
