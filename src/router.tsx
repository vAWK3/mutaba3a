/* eslint-disable react-refresh/only-export-components */
import React, { Suspense } from 'react';
import { createRouter, createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from './components/layout';
import { BrandLoader } from './components/brand/BrandLoader';
import { useT } from './lib/i18n';
import { requireFeature } from './lib/features/routeGuard';
import { parseIncomeSearch } from './lib/incomeSearch';
import { parseClientsSearch } from './components/clients/clientsSearch';
import { clientProfileRemountDeps } from './components/clients/clientsSplitView';

// Keep OverviewPage eager (it's the landing page)
import { OverviewPage } from './pages/overview/OverviewPage';

/**
 * A route still downloading its code (or waiting on a feature gate): the bloom
 * loader at 64 in the same page box and spot the page's own data loader uses,
 * so code download plus data load read as one wait (MUT-206 DR2; DR11 skips
 * the second loader's delay).
 */
const PageLoader = () => {
  const t = useT();
  return (
    <div className="page-content">
      <div className="loading">
        <BrandLoader size={64} slowCaption={t('common.loadingSlow')} />
      </div>
    </div>
  );
};

// Helper for lazy routes with named exports
function lazyPage(
  factory: () => Promise<Record<string, React.ComponentType<unknown>>>,
  exportName: string
) {
  const LazyComponent = React.lazy(() =>
    factory().then((mod) => ({ default: mod[exportName] }))
  );
  return () => (
    <Suspense fallback={<PageLoader />}>
      <LazyComponent />
    </Suspense>
  );
}

// Root route with AppShell layout
const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

// Overview route. Home and Clients are the owed screens: "All businesses"
// applies to them only (MUT-89, ADR-051), read by AppShell's useOwedScreenSync.
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  staticData: { owedLens: true },
  component: OverviewPage,
});

// Income route (dedicated income tracking page). Its filters are the URL (MUT-83).
const incomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/income',
  validateSearch: parseIncomeSearch,
  component: lazyPage(() => import('./pages/income'), 'IncomePage'),
});

// Insights route (consolidates reports and cash-flow analysis)
const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  beforeLoad: requireFeature('insights'),
  component: lazyPage(() => import('./pages/insights'), 'InsightsPage'),
});

// Transactions route (legacy redirect to /income)
const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/income',
      search: search as Record<string, unknown>,
    });
  },
});

// Projects routes
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  beforeLoad: requireFeature('projects'),
  component: lazyPage(() => import('./pages/projects/ProjectsPage'), 'ProjectsPage'),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  beforeLoad: requireFeature('projects'),
  component: lazyPage(() => import('./pages/projects/ProjectDetailPage'), 'ProjectDetailPage'),
});

// Clients routes (MUT-84, ADR-050): one layout keeps the list mounted and, on
// a wide window, opens a client beside it. The URLs are unchanged. The list's
// search and sort are the URL, on the list and on a client alike.
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  // An owed screen (MUT-89); a client beside the list sits under this layout
  staticData: { owedLens: true },
  validateSearch: parseClientsSearch,
  component: lazyPage(() => import('./pages/clients/ClientsLayout'), 'ClientsLayout'),
});

// The full list, with nothing beside it
const clientsIndexRoute = createRoute({
  getParentRoute: () => clientsRoute,
  path: '/',
  component: () => null,
});

// Another client gets a fresh profile; a resize never remounts it
const clientDetailRoute = createRoute({
  getParentRoute: () => clientsRoute,
  path: '$clientId',
  remountDeps: clientProfileRemountDeps,
  component: lazyPage(() => import('./pages/clients/ClientDetailPage'), 'ClientDetailPage'),
});

// Reports route (legacy redirect to /insights)
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => {
    throw redirect({ to: '/insights' });
  },
});

// Retired document routes (MUT-145): document generation is gone. Stale
// links and bookmarks land on Home, where a switched-off area also sends them.
const legacyDocumentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});

const legacyDocumentsSplatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$',
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage'),
});

// Retired profile detail page (MUT-145): profiles are edited in the business
// profile drawer from Settings.
const legacyProfileDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/profiles/$profileId',
  beforeLoad: () => {
    throw redirect({ to: '/settings' });
  },
});

// Import data route (under settings)
const importDataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/import',
  component: lazyPage(() => import('./pages/settings/ImportDataPage'), 'ImportDataPage'),
});

// Theme demo route (for visual testing)
const themeDemoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/theme-demo',
  component: lazyPage(() => import('./components/examples/ThemeDemo'), 'ThemeDemo'),
});

// ============================================================================
// Expense Routes
// ============================================================================

// Expenses search params
// Main expenses route - uses the new question-first ExpensesLedgerPage
const expensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses',
  beforeLoad: requireFeature('expenses'),
  component: lazyPage(() => import('./pages/expenses/ExpensesLedgerPage'), 'ExpensesLedgerPage'),
});

// Conversions route (MUT-141): logged currency-conversion events, excluded
// from P&L by construction. A new dedicated page, not folded into the
// income/expense ledgers -- see .claude/designs/mut-141-currency-conversion.md.
const conversionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversions',
  beforeLoad: requireFeature('conversions'),
  component: lazyPage(() => import('./pages/conversions/ConversionsPage'), 'ConversionsPage'),
});

// Legacy route (MUT-14): the per-profile expenses overview was removed; old links land on the ledger,
// which then applies the Expenses switch.
const expenseProfilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profiles',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Legacy route (MUT-14): the profile expenses page was removed; old links land on the ledger,
// which then applies the Expenses switch.
const profileExpensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profile/$profileId',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Legacy route (MUT-14): the receipts page (files are exportable from Settings › Your data) was removed; old links land on the ledger,
// which then applies the Expenses switch.
const profileReceiptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profile/$profileId/receipts',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Legacy route (MUT-14): the monthly expenses overview was removed; old links land on the ledger,
// which then applies the Expenses switch.
const expensesOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/overview',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Legacy route (MUT-14): the expenses forecast was removed; old links land on the ledger,
// which then applies the Expenses switch.
const expensesForecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/forecast',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Legacy route (MUT-14): the suppliers view (a second view over vendors) was removed; old links land on the ledger,
// which then applies the Expenses switch.
const suppliersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suppliers',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Legacy route (MUT-14): the vendors management page (vendors stay editable from the expense drawer) was removed; old links land on the ledger,
// which then applies the Expenses switch.
const expensesVendorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/vendors',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// ============================================================================
// Retainer Routes
// ============================================================================

// Retainers search params
interface RetainersSearch {
  status?: 'draft' | 'active' | 'paused' | 'ended';
  currency?: 'USD' | 'ILS';
  clientId?: string;
}

const retainersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/retainers',
  beforeLoad: requireFeature('retainers'),
  component: lazyPage(() => import('./pages/retainers/RetainersPage'), 'RetainersPage'),
  validateSearch: (search: Record<string, unknown>): RetainersSearch => {
    return {
      status: search.status === 'draft' || search.status === 'active' || search.status === 'paused' || search.status === 'ended'
        ? search.status
        : undefined,
      currency: search.currency === 'USD' || search.currency === 'ILS' ? search.currency : undefined,
      clientId: typeof search.clientId === 'string' ? search.clientId : undefined,
    };
  },
});

// ============================================================================
// Financial Planning Routes
// ============================================================================

interface PlanningSearch {
  plan?: string;
  scenario?: string;
}

const planningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planning',
  beforeLoad: requireFeature('planning'),
  component: lazyPage(() => import('./pages/planning'), 'PlanningPage'),
  validateSearch: (search: Record<string, unknown>): PlanningSearch => {
    return {
      plan: typeof search.plan === 'string' ? search.plan : undefined,
      scenario: typeof search.scenario === 'string' ? search.scenario : undefined,
    };
  },
});

// Monthly close search params
// Legacy route (MUT-14): the month-close checklist was removed; old links land on the ledger,
// which then applies the Expenses switch.
const monthCloseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/close/profile/$profileId',
  beforeLoad: () => {
    throw redirect({ to: '/expenses' });
  },
});

// Create route tree
const routeTree = rootRoute.addChildren([
  overviewRoute,
  // New question-first routes
  incomeRoute,
  insightsRoute,
  // Legacy routes (kept for backwards compatibility)
  transactionsRoute,
  projectsRoute,
  projectDetailRoute,
  clientsRoute.addChildren([clientsIndexRoute, clientDetailRoute]),
  legacyDocumentsRoute,
  legacyDocumentsSplatRoute,
  // Expense routes
  expensesRoute,
  conversionsRoute,
  expenseProfilesRoute,
  profileExpensesRoute,
  profileReceiptsRoute,
  expensesOverviewRoute,
  expensesForecastRoute,
  expensesVendorsRoute,
  suppliersRoute,
  monthCloseRoute,
  // Retainer routes
  retainersRoute,
  // Financial Planning route
  planningRoute,
  // Reports route
  reportsRoute,
  settingsRoute,
  legacyProfileDetailRoute,
  importDataRoute,
  themeDemoRoute,
]);

// Create router with conditional basepath for web build
export const router = createRouter({
  routeTree,
  basepath: __BUILD_MODE__ === 'web' ? '/app' : undefined,
  // Routes with an async beforeLoad (feature gates, MUT-13) start pending;
  // show the same loader the lazy pages use instead of a blank first paint.
  defaultPendingComponent: PageLoader,
});

// Type declaration for router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** Home and Clients: the screens "All businesses" applies to (MUT-89, ADR-051) */
    owedLens?: boolean;
  }
}
