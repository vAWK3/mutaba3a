import { createRouter, createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/layout';

// Pages
import { OverviewPage } from './pages/overview/OverviewPage';
import { TransactionsPage } from './pages/transactions/TransactionsPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { ClientsPage } from './pages/clients/ClientsPage';
import { ClientDetailPage } from './pages/clients/ClientDetailPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { DownloadPage } from './pages/download/DownloadPage';
import { ThemeDemo } from './components/examples/ThemeDemo';

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
  component: TransactionsPage,
});

// Projects routes
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: ProjectDetailPage,
});

// Clients routes
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: ClientsPage,
});

const clientDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  component: ClientDetailPage,
});

// Reports route
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: ReportsPage,
});

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

// Download route (standalone landing page)
const downloadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/download',
  component: DownloadPage,
});

// Theme demo route (for visual testing)
const themeDemoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/theme-demo',
  component: ThemeDemo,
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
