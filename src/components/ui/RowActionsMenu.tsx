import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreIcon } from '../icons';
import './RowActionsMenu.css';

export interface RowAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
}

interface RowActionsMenuProps {
  actions: RowAction[];
}

export function RowActionsMenu({ actions }: RowActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  // Update menu position when opened
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 140; // min-width from CSS

      // Position below the trigger, aligned to the end (right in LTR, left in RTL)
      const isRTL = document.documentElement.dir === 'rtl';
      const left = isRTL
        ? rect.left
        : rect.right - menuWidth;

      setMenuPosition({
        top: rect.bottom + 4, // 4px gap (--space-1)
        left: Math.max(8, left), // Keep at least 8px from edge
      });
    }
  }, [isOpen]);

  // Handle click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    function updatePosition() {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const menuWidth = 140;
        const isRTL = document.documentElement.dir === 'rtl';
        const left = isRTL ? rect.left : rect.right - menuWidth;

        setMenuPosition({
          top: rect.bottom + 4,
          left: Math.max(8, left),
        });
      }
    }

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  if (actions.length === 0) return null;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleActionClick = (e: React.MouseEvent, action: RowAction) => {
    e.stopPropagation();
    action.onClick();
    setIsOpen(false);
  };

  return (
    <div className="row-actions-container">
      <button
        ref={triggerRef}
        type="button"
        className="row-actions-trigger"
        onClick={handleToggle}
        aria-label="Actions"
        aria-expanded={isOpen}
      >
        <MoreIcon size={18} />
      </button>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="row-actions-menu"
          role="menu"
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className={`row-actions-item ${action.variant === 'danger' ? 'row-actions-item-danger' : ''}`}
              onClick={(e) => handleActionClick(e, action)}
              role="menuitem"
            >
              {action.icon && <span className="row-actions-icon">{action.icon}</span>}
              <span>{action.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
