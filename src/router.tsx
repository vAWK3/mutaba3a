import React, { Suspense } from 'react';
import { createRouter, createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/layout';

// Keep OverviewPage eager (it's the landing page)
import { OverviewPage } from './pages/overview/OverviewPage';

// Simple loading fallback
const PageLoader = () => (
  <div style={{ padding: '2rem', opacity: 0.5 }}>Loading...</div>
);

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

// Overview route
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
});

// Transactions route with search params
interface TransactionsSearch {
  dateFrom?: string;
  dateTo?: string;
  currency?: 'USD' | 'ILS';
  kind?: 'income' | 'expense';
  status?: 'paid' | 'unpaid' | 'overdue';
}

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  component: lazyPage(() => import('./pages/transactions/TransactionsPage'), 'TransactionsPage'),
  validateSearch: (search: Record<string, unknown>): TransactionsSearch => {
    return {
      dateFrom: typeof search.dateFrom === 'string' ? search.dateFrom : undefined,
      dateTo: typeof search.dateTo === 'string' ? search.dateTo : undefined,
      currency: search.currency === 'USD' || search.currency === 'ILS' ? search.currency : undefined,
      kind: search.kind === 'income' || search.kind === 'expense' ? search.kind : undefined,
      status: search.status === 'paid' || search.status === 'unpaid' || search.status === 'overdue' ? search.status : undefined,
    };
  },
});

// Projects routes
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: lazyPage(() => import('./pages/projects/ProjectsPage'), 'ProjectsPage'),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: lazyPage(() => import('./pages/projects/ProjectDetailPage'), 'ProjectDetailPage'),
});

// Clients routes
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: lazyPage(() => import('./pages/clients/ClientsPage'), 'ClientsPage'),
});

const clientDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  component: lazyPage(() => import('./pages/clients/ClientDetailPage'), 'ClientDetailPage'),
});

// Reports route
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: lazyPage(() => import('./pages/reports/ReportsPage'), 'ReportsPage'),
});

// Documents routes
const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  component: lazyPage(() => import('./pages/documents'), 'DocumentsPage'),
});

const documentNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/new',
  component: lazyPage(() => import('./pages/documents'), 'DocumentFormPage'),
});

const documentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$documentId',
  component: lazyPage(() => import('./pages/documents'), 'DocumentDetailPage'),
});

const documentEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$documentId/edit',
  component: lazyPage(() => import('./pages/documents'), 'DocumentFormPage'),
});

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage'),
});

// Profile detail route (under settings)
const profileDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/profiles/$profileId',
  component: lazyPage(() => import('./pages/settings/ProfileDetailPage'), 'ProfileDetailPage'),
});

// Download route (standalone landing page)
const downloadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/download',
  component: lazyPage(() => import('./pages/download/DownloadPage'), 'DownloadPage'),
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
interface ExpensesSearch {
  year?: number;
  month?: number;
  currency?: 'USD' | 'ILS';
  categoryId?: string;
}

const expensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses',
  component: lazyPage(() => import('./pages/expenses/ExpensesPage'), 'ExpensesPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
    };
  },
});

const profileExpensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profile/$profileId',
  component: lazyPage(() => import('./pages/expenses/ProfileExpensesPage'), 'ProfileExpensesPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
      month: typeof search.month === 'number' ? search.month : undefined,
      currency: search.currency === 'USD' || search.currency === 'ILS' ? search.currency : undefined,
      categoryId: typeof search.categoryId === 'string' ? search.categoryId : undefined,
    };
  },
});

const profileReceiptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profile/$profileId/receipts',
  component: lazyPage(() => import('./pages/expenses/ReceiptsPage'), 'ReceiptsPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
      month: typeof search.month === 'number' ? search.month : undefined,
    };
  },
});

const expensesOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/overview',
  component: lazyPage(() => import('./pages/expenses/ExpensesOverviewPage'), 'ExpensesOverviewPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
    };
  },
});

const expensesForecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/forecast',
  component: lazyPage(() => import('./pages/expenses/ExpensesForecastPage'), 'ExpensesForecastPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
    };
  },
});

// Monthly close search params
interface MonthCloseSearch {
  month?: string;
}

const monthCloseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/close/profile/$profileId',
  component: lazyPage(() => import('./pages/expenses/MonthCloseChecklistPage'), 'MonthCloseChecklistPage'),
  validateSearch: (search: Record<string, unknown>): MonthCloseSearch => {
    return {
      month: typeof search.month === 'string' ? search.month : undefined,
    };
  },
});

// Create route tree
const routeTree = rootRoute.addChildren([
  overviewRoute,
  transactionsRoute,
  projectsRoute,
  projectDetailRoute,
  clientsRoute,
  clientDetailRoute,
  documentsRoute,
  documentNewRoute,
  documentDetailRoute,
  documentEditRoute,
  // Expense routes
  expensesRoute,
  profileExpensesRoute,
  profileReceiptsRoute,
  expensesOverviewRoute,
  expensesForecastRoute,
  monthCloseRoute,
  reportsRoute,
  settingsRoute,
  profileDetailRoute,
  downloadRoute,
  themeDemoRoute,
]);

// Create router
export const router = createRouter({ routeTree });

// Type declaration for router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
