import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useDrawerFocus } from './useDrawerFocus';
import { useDrawerMotion } from './useDrawerMotion';

export interface DrawerFrameProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
}

/**
 * The slide-over shell every drawer renders, in the local app and in the
 * hosted portal (MUT-80; the portal imports it from `components/ui`, which its
 * lint boundary allows). It springs in from its edge, follows a horizontal
 * drag, and leaves the way it came (`useDrawerMotion`); it holds keyboard
 * focus while open and gives it back after (`useDrawerFocus`).
 *
 * `onClose` keeps its contract: Escape, the close button and the overlay call
 * it at once, and callers unmount the drawer whenever they like. The exit
 * plays after the drawer has gone.
 */
export function DrawerFrame({ title, onClose, children, footer, closeLabel }: DrawerFrameProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragHandlers = useDrawerMotion({ panelRef, overlayRef, onDismiss: onClose });
  const { onKeyDown } = useDrawerFocus(panelRef);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      <div ref={overlayRef} className="drawer-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        {...dragHandlers}
      >
        <div className="drawer-header">
          <h2 id={titleId} className="drawer-title">
            {title}
          </h2>
          <button type="button" className="drawer-close press" onClick={onClose} aria-label={closeLabel}>
            <CloseIcon />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
