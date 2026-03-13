import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { useCheckForUpdates } from "../../hooks/useCheckForUpdates";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useDrawerStore } from "../../lib/stores";
import { useProfileAwareAction } from "../../hooks/useProfileAwareAction";
import { ProfileQuickPicker } from "../ui/ProfileQuickPicker";

// Storage key for collapsed state
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

function useCollapsedState() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  return [collapsed, toggle] as const;
}

// Navigation item type
interface NavItem {
  path: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: "hasUpdate";
}

// Navigation section type
interface NavSection {
  key: string;
  labelKey: string;
  items: NavItem[];
}

// Define navigation sections (question-first UX redesign)
const navSections: NavSection[] = [
  {
    key: "main",
    labelKey: "nav.sections.main",
    items: [
      { path: "/", labelKey: "nav.home", icon: HomeIcon, exact: true },
      { path: "/income", labelKey: "nav.income", icon: IncomeIcon },
      { path: "/expenses", labelKey: "nav.expenses", icon: ExpensesIcon },
      { path: "/insights", labelKey: "nav.insights", icon: InsightsIcon },
    ],
  },
  {
    key: "workspace",
    labelKey: "nav.sections.workspace",
    items: [
      { path: "/clients", labelKey: "nav.clients", icon: UsersIcon },
      { path: "/projects", labelKey: "nav.projects", icon: FolderIcon },
    ],
  },
];

// System section items (rendered in footer)
const systemItems: NavItem[] = [
  {
    path: "/settings",
    labelKey: "nav.settings",
    icon: SettingsIcon,
    badge: "hasUpdate",
  },
];

// New action menu items (simplified for question-first UX)
type NewMenuAction = "income" | "expense" | "client" | "project";

const newMenuItems: {
  key: NewMenuAction;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "income", labelKey: "nav.newMenu.income", icon: IncomeIcon },
  { key: "expense", labelKey: "nav.newMenu.expense", icon: ExpensesIcon },
  { key: "client", labelKey: "nav.newMenu.client", icon: UsersIcon },
  { key: "project", labelKey: "nav.newMenu.project", icon: FolderIcon },
];

export function SidebarNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const { hasUpdate } = useCheckForUpdates();
  const [collapsed, toggleCollapsed] = useCollapsedState();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  // Global drawer state from stores
  const openIncomeDrawer = useDrawerStore((s) => s.openIncomeDrawer);
  const openClientDrawer = useDrawerStore((s) => s.openClientDrawer);
  const openProjectDrawer = useDrawerStore((s) => s.openProjectDrawer);
  const openExpenseDrawer = useDrawerStore((s) => s.openExpenseDrawer);

  // Profile-aware action hooks for income and expense creation
  const incomeAction = useProfileAwareAction({
    onExecute: (profileId) => {
      openIncomeDrawer({
        mode: "create",
        defaultStatus: "earned",
        defaultProfileId: profileId,
      });
      navigate({ to: "/income" });
    },
  });

  const expenseAction = useProfileAwareAction({
    onExecute: (profileId) => {
      openExpenseDrawer({ mode: "create", defaultProfileId: profileId });
      navigate({ to: "/expenses" });
    },
  });

  // Close menu on outside click
  useEffect(() => {
    if (!newMenuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        newMenuRef.current &&
        !newMenuRef.current.contains(e.target as Node) &&
        newButtonRef.current &&
        !newButtonRef.current.contains(e.target as Node)
      ) {
        setNewMenuOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNewMenuOpen(false);
        newButtonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [newMenuOpen]);

  // Check if a nav item is active
  const isItemActive = (item: NavItem): boolean => {
    if (item.exact) {
      return location.pathname === item.path;
    }
    return (
      location.pathname === item.path ||
      location.pathname.startsWith(item.path + "/")
    );
  };

  // Handle new menu action
  const handleNewAction = (
    action: NewMenuAction,
    event: React.MouseEvent<HTMLElement>,
  ) => {
    setNewMenuOpen(false);
    switch (action) {
      case "income":
        // Use profile-aware action - will show picker if in "All Profiles" mode
        incomeAction.trigger(event);
        break;
      case "expense":
        // Use profile-aware action - will show picker if in "All Profiles" mode
        expenseAction.trigger(event);
        break;
      case "client":
        openClientDrawer({ mode: "create" });
        navigate({ to: "/clients" });
        break;
      case "project":
        openProjectDrawer({ mode: "create" });
        navigate({ to: "/projects" });
        break;
    }
  };

  // Render a single nav item
  const renderNavItem = (item: NavItem, showBadge: boolean = false) => {
    const Icon = item.icon;
    const isActive = isItemActive(item);
    const showUpdateBadge =
      showBadge && item.badge === "hasUpdate" && hasUpdate;

    // Use <a> for download link (outside router scope, avoids basepath)
    const isExternalPath = item.path === "/download";

    const content = (
      <>
        {isActive && <span className="nav-item-rail" aria-hidden="true" />}
        <span className="nav-item-icon-wrapper">
          <Icon className="nav-icon" />
          {collapsed && showUpdateBadge && (
            <span
              className="nav-item-dot"
              aria-label={t("settings.updates.updateAvailable")}
            />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="nav-item-label">{t(item.labelKey)}</span>
            {showUpdateBadge && <span className="update-indicator" />}
          </>
        )}
      </>
    );

    if (isExternalPath) {
      return (
        <a
          key={item.path}
          href={item.path}
          className={cn("nav-item", isActive && "active")}
          aria-current={isActive ? "page" : undefined}
          title={collapsed ? t(item.labelKey) : undefined}
        >
          {content}
        </a>
      );
    }

    return (
      <Link
        key={item.path}
        to={item.path}
        className={cn("nav-item", isActive && "active")}
        aria-current={isActive ? "page" : undefined}
        title={collapsed ? t(item.labelKey) : undefined}
      >
        {content}
      </Link>
    );
  };

  // Render a section
  const renderSection = (section: NavSection) => {
    return (
      <div key={section.key} className="nav-section">
        {!collapsed && (
          <div className="nav-section-header">{t(section.labelKey)}</div>
        )}
        <div className="nav-section-items">
          {section.items.map((item) => renderNavItem(item))}
        </div>
      </div>
    );
  };

  return (
    <aside className={cn("sidebar", collapsed && "collapsed")}>
      {/* Header with brand and collapse toggle */}
      <div className="sidebar-header">
        <Link to="/" className="brand" aria-label="متابعة">
          <img
            className="brand-mark"
            src="/icons/icon-512.png"
            srcSet="/icons/icon-512.png 1x, /icons/icon-1024.png 2x"
            alt=""
            width={28}
            height={28}
            loading="eager"
            decoding="async"
          />
          {!collapsed && (
            <span className="brand-name" lang="ar" dir="rtl">
              متابعة
            </span>
          )}
        </Link>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          <ChevronIcon className={cn("nav-icon", collapsed && "rotated")} />
        </button>
      </div>

      {/* Profile Switcher */}
      <div className="sidebar-profile">
        <ProfileSwitcher collapsed={collapsed} />
      </div>

      {/* New Action Button */}
      <div className="new-action-section">
        <button
          ref={newButtonRef}
          type="button"
          className={cn("new-action-btn", newMenuOpen && "active")}
          onClick={() => setNewMenuOpen(!newMenuOpen)}
          title={collapsed ? t("nav.new") : undefined}
          aria-expanded={newMenuOpen}
          aria-haspopup="menu"
        >
          <PlusIcon className="nav-icon" />
          {!collapsed && (
            <span className="new-action-label">{t("nav.new")}</span>
          )}
        </button>

        {newMenuOpen && (
          <div
            ref={newMenuRef}
            className={cn("new-action-menu", collapsed && "collapsed-menu")}
            role="menu"
          >
            {newMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className="new-action-menu-item"
                  role="menuitem"
                  onClick={(e) => handleNewAction(item.key, e)}
                >
                  <Icon className="nav-icon" />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Profile pickers for income/expense creation in "All Profiles" mode */}
        <ProfileQuickPicker {...incomeAction.pickerProps} />
        <ProfileQuickPicker {...expenseAction.pickerProps} />
      </div>

      {/* Main Navigation */}
      <nav className="sidebar-nav">{navSections.map(renderSection)}</nav>

      {/* Footer with system items */}
      <div className="sidebar-footer">
        {!collapsed && (
          <div className="nav-section-header">{t("nav.sections.system")}</div>
        )}
        {systemItems.map((item) => renderNavItem(item, true))}
      </div>

      {/* Expand toggle (visible only when collapsed) */}
      {collapsed && (
        <button
          type="button"
          className="sidebar-expand-toggle"
          onClick={toggleCollapsed}
          aria-label={t("nav.expand")}
          title={t("nav.expand")}
        >
          <ExpandIcon className="nav-icon" />
        </button>
      )}
    </aside>
  );
}

// Icons

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
      />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
      />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
}

// function ChartIcon({ className }: { className?: string }) {
//   return (
//     <svg
//       className={className}
//       fill="none"
//       viewBox="0 0 24 24"
//       stroke="currentColor"
//       strokeWidth={1.5}
//     >
//       <path
//         strokeLinecap="round"
//         strokeLinejoin="round"
//         d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
//       />
//     </svg>
//   );
// }

function ExpensesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z"
      />
    </svg>
  );
}

function IncomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function InsightsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 19.5 8.25 12l7.5-7.5"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
      />
    </svg>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </svg>
  );
}
