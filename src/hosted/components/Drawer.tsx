import { useEffect, type ReactNode } from 'react';

/**
 * The portal's own slide-over shell (MUT-44 design brief §6a point 5). Not an
 * import of src/components/drawers/Drawer.tsx — that path is lint-banned from
 * src/hosted/** ("the portal has its own shell and no drawers",
 * hosted-portal.md §2) — but it renders the exact same `.drawer`/
 * `.drawer-overlay`/etc. classes from `src/index.css`, which both builds
 * already import, so the interaction and the pixels match the local app's
 * drawer without owning or duplicating its component.
 */
export interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
}

export function Drawer({ title, onClose, children, footer, closeLabel }: DrawerProps) {
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-header">
          <h2 className="drawer-title">{title}</h2>
          <button type="button" className="drawer-close" onClick={onClose} aria-label={closeLabel}>
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
