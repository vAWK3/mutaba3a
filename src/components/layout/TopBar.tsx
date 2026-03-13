import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useProfileAwareAction } from '../../hooks/useProfileAwareAction';
import { ProfileQuickPicker } from '../ui/ProfileQuickPicker';
import { useDrawerStore } from '../../lib/stores';
import { useT, useDirection } from '../../lib/i18n';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface TopBarProps {
  title: string;
  breadcrumbs?: Breadcrumb[];
  filterSlot?: ReactNode;
  rightSlot?: ReactNode;
  hideAddMenu?: boolean;
}

export function TopBar({ title, breadcrumbs, filterSlot, rightSlot, hideAddMenu }: TopBarProps) {
  const direction = useDirection();
  // Use appropriate separator based on direction
  const separator = direction === 'rtl' ? ' \\ ' : ' / ';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className="breadcrumbs">
              {breadcrumbs.map((crumb, index) => (
                <span key={index}>
                  {crumb.href ? (
                    <Link to={crumb.href} className="breadcrumb-link">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="breadcrumb-current">{crumb.label}</span>
                  )}
                  {index < breadcrumbs.length - 1 && (
                    <span className="breadcrumb-separator">{separator}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <h1 className="topbar-title">{title}</h1>
        </div>
        {filterSlot}
      </div>
      <div className="topbar-right">
        {rightSlot}
        {!hideAddMenu && <AddMenu />}
      </div>
    </header>
  );
}

function AddMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { openIncomeDrawer, openExpenseDrawer, openClientDrawer, openProjectDrawer } = useDrawerStore();
  const t = useT();

  // Profile-aware actions for income and expense
  const incomeAction = useProfileAwareAction({
    onExecute: (profileId) => {
      openIncomeDrawer({ mode: 'create', defaultStatus: 'earned', defaultProfileId: profileId });
    },
  });

  const expenseAction = useProfileAwareAction({
    onExecute: (profileId) => {
      openExpenseDrawer({ mode: 'create', defaultProfileId: profileId });
    },
  });

  const clientAction = useProfileAwareAction({
    onExecute: (profileId) => {
      openClientDrawer({ mode: 'create', defaultProfileId: profileId });
    },
  });

  const projectAction = useProfileAwareAction({
    onExecute: (profileId) => {
      openProjectDrawer({ mode: 'create', defaultProfileId: profileId });
    },
  });

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

  const handleAction = (action: 'income' | 'expense' | 'client' | 'project', event: React.MouseEvent<HTMLElement>) => {
    setIsOpen(false);
    switch (action) {
      case 'income':
        incomeAction.trigger(event);
        break;
      case 'expense':
        expenseAction.trigger(event);
        break;
      case 'client':
        clientAction.trigger(event);
        break;
      case 'project':
        projectAction.trigger(event);
        break;
    }
  };

  return (
    <>
      <div className="add-menu-container" ref={containerRef}>
        <button className="btn btn-primary" onClick={() => setIsOpen(!isOpen)}>
          <PlusIcon />
          {t('common.add')}
        </button>
        {isOpen && (
          <div className="add-menu">
            <button
              className="add-menu-item"
              onClick={(e) => handleAction('income', e)}
            >
              <DollarIcon className="nav-icon" />
              {t('addMenu.income')}
            </button>
            <button
              className="add-menu-item"
              onClick={(e) => handleAction('expense', e)}
            >
              <MinusIcon className="nav-icon" />
              {t('addMenu.expense')}
            </button>
            <button
              className="add-menu-item"
              onClick={(e) => handleAction('project', e)}
            >
              <FolderPlusIcon className="nav-icon" />
              {t('addMenu.project')}
            </button>
            <button
              className="add-menu-item"
              onClick={(e) => handleAction('client', e)}
            >
              <UserPlusIcon className="nav-icon" />
              {t('addMenu.client')}
            </button>
          </div>
        )}
      </div>

      {/* Profile quick pickers for each action type */}
      <ProfileQuickPicker {...incomeAction.pickerProps} />
      <ProfileQuickPicker {...expenseAction.pickerProps} />
      <ProfileQuickPicker {...clientAction.pickerProps} />
      <ProfileQuickPicker {...projectAction.pickerProps} />
    </>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function FolderPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function UserPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
    </svg>
  );
}
