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

// Transactions route
const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  component: lazyPage(() => import('./pages/transactions/TransactionsPage'), 'TransactionsPage'),
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

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage'),
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

// Create route tree
const routeTree = rootRoute.addChildren([
  overviewRoute,
  transactionsRoute,
  projectsRoute,
  projectDetailRoute,
  clientsRoute,
  clientDetailRoute,
  reportsRoute,
  settingsRoute,
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
