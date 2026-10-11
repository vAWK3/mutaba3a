/* eslint-disable react-refresh/only-export-components */
import { Navigate, Outlet, createRootRoute, createRoute, createRouter, useNavigate, type RouterHistory } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { SignInPage, type ArrivalReason } from './pages/auth/SignInPage';
import { AuthGate, HomeRedirect, ProfileLayout } from './session/AuthGate';
import { SessionBridge } from './session/SessionBridge';
import { parseClientDetail, parseClients, parseDocuments, parseExpensesPage, parseOverview, parsePayments, parseReceivables } from './data/filters';
import { OverviewPage } from './pages/views/OverviewPage';
import { ClientsPage } from './pages/views/ClientsPage';
import { ClientDetailPage } from './pages/views/ClientDetailPage';
import { ReceivablesPage } from './pages/views/ReceivablesList';
import { PaymentsPage } from './pages/views/PaymentsList';
import { DocumentsPage } from './pages/views/DocumentsList';
import { ExpensesPage } from './pages/views/ExpensesList';

/**
 * The portal's routes (hosted-portal.md §7.1, code-based like `src/router.tsx`).
 * The active profile is in the path, so it is deep-linkable and safe across
 * tabs; each list view's filters are its search params. The router is built by
 * a factory and never registered globally: `src` is one TypeScript program, and
 * a global registration would retype the app's own navigation.
 */

type Raw = Record<string, unknown>;

function parseSignIn(raw: Raw): { next?: string; reason?: ArrivalReason } {
  const next = typeof raw.next === 'string' ? raw.next : undefined;
  const reason = raw.reason === 'expired' || raw.reason === 'signed_out' ? raw.reason : undefined;
  return { ...(next ? { next } : {}), ...(reason ? { reason } : {}) };
}

/** Replace the route's search with `next` (one object, `replace` so filters never pile up in history). */
function useReplaceSearch<T extends object>() {
  const navigate = useNavigate();
  return (next: T) => void navigate({ to: '.', search: next as Raw, replace: true });
}

function RootLayout() {
  return (
    <>
      <SessionBridge />
      <Outlet />
    </>
  );
}

export function createPortalRouter(queryClient: QueryClient, history?: RouterHistory) {
  const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: () => <Navigate to="/" replace /> });

  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    validateSearch: parseSignIn,
    component: function SignIn() {
      const { next, reason } = signInRoute.useSearch();
      return <SignInPage next={next} reason={reason} />;
    },
  });

  const authedRoute = createRoute({ getParentRoute: () => rootRoute, id: 'authed', component: AuthGate });

  const homeRoute = createRoute({ getParentRoute: () => authedRoute, path: '/', component: HomeRedirect });

  const profileRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: '/p/$profileId',
    component: function Profile() {
      const { profileId } = profileRoute.useParams();
      return <ProfileLayout profileId={profileId} />;
    },
  });

  const overviewRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/',
    validateSearch: parseOverview,
    component: function Overview() {
      return <OverviewPage filters={overviewRoute.useSearch()} setFilters={useReplaceSearch()} />;
    },
  });

  const clientsRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/clients',
    validateSearch: parseClients,
    component: function Clients() {
      return <ClientsPage filters={clientsRoute.useSearch()} setFilters={useReplaceSearch()} />;
    },
  });

  const clientRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/clients/$customerId',
    validateSearch: parseClientDetail,
    component: function Client() {
      const { customerId } = clientRoute.useParams();
      return <ClientDetailPage key={customerId} customerId={customerId} search={clientRoute.useSearch()} setSearch={useReplaceSearch()} />;
    },
  });

  const receivablesRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/receivables',
    validateSearch: parseReceivables,
    component: function Receivables() {
      return <ReceivablesPage filters={receivablesRoute.useSearch()} setFilters={useReplaceSearch()} />;
    },
  });

  const paymentsRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/payments',
    validateSearch: parsePayments,
    component: function Payments() {
      return <PaymentsPage filters={paymentsRoute.useSearch()} setFilters={useReplaceSearch()} />;
    },
  });

  const documentsRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/documents',
    validateSearch: parseDocuments,
    component: function Documents() {
      return <DocumentsPage filters={documentsRoute.useSearch()} setFilters={useReplaceSearch()} />;
    },
  });

  const expensesRoute = createRoute({
    getParentRoute: () => profileRoute,
    path: '/expenses',
    validateSearch: parseExpensesPage,
    component: function Expenses() {
      return <ExpensesPage filters={expensesRoute.useSearch()} setFilters={useReplaceSearch()} />;
    },
  });

  const routeTree = rootRoute.addChildren([
    signInRoute,
    authedRoute.addChildren([
      homeRoute,
      profileRoute.addChildren([overviewRoute, clientsRoute, clientRoute, receivablesRoute, paymentsRoute, documentsRoute, expensesRoute]),
    ]),
  ]);

  return createRouter({ routeTree, history, context: { queryClient }, defaultPreload: false });
}

export type PortalRouter = ReturnType<typeof createPortalRouter>;
