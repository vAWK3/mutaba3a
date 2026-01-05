import { useState, useRef, useEffect, type ReactNode } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
    <div className="row-actions-container" ref={containerRef}>
      <button
        type="button"
        className="row-actions-trigger"
        onClick={handleToggle}
        aria-label="Actions"
        aria-expanded={isOpen}
      >
        <MoreIcon size={18} />
      </button>
      {isOpen && (
        <div className="row-actions-menu" role="menu">
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
        </div>
      )}
    </div>
  );
}
