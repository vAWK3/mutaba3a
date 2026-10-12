import { useEffect, useId, type ReactNode } from 'react';
import { useT } from '../../lib/i18n';

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ title, onClose, children, footer }: DrawerProps) {
  const t = useT();
  // The dialog is named by its visible title (TD-009, axe aria-dialog-name)
  const titleId = useId();

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="drawer-header">
          <h2 className="drawer-title" id={titleId}>{title}</h2>
          <button className="drawer-close" onClick={onClose} aria-label={t('common.close')}>
            <XIcon />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
