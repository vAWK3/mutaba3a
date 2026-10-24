/* eslint-disable react-refresh/only-export-components */
import { Navigate, Outlet, createRootRoute, createRoute, createRouter, useNavigate, type RouterHistory } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { SignInPage, type ArrivalReason } from './pages/auth/SignInPage';
import { SetupPage } from './pages/auth/SetupPage';
import { SignupPage } from './pages/auth/SignupPage';
import { RecoverPage } from './pages/auth/RecoverPage';
import { CarryOverPage } from './pages/carry-over/CarryOverPage';
import { ReceivePage } from './pages/carry-over/ReceivePage';
import { AuthGate, CaptureRedirect, HomeRedirect, ProfileLayout } from './session/AuthGate';
import { SessionBridge } from './session/SessionBridge';
import { useLocalStop } from './session/localStop';
import { ReloadToContinue } from './pages/auth/BootScreens';
import { CrashCard } from './components/QueryView';
import { reportBoundaryError } from './observability/errorReporting';
import { omitShellOverlay, parseClientDetail, parseClients, parseConversionsPage, parseDocuments, parseExpensesPage, parseGroupDetail, parseGroupsPage, parseOverview, parsePaymentsPage, parseReceivablesPage, parseReports, pickShellOverlay } from './data/filters';
import { OverviewPage } from './pages/views/OverviewPage';
import { ReportsPage } from './pages/views/ReportsPage';
import { ClientsPage } from './pages/views/ClientsPage';
import { ClientDetailPage } from './pages/views/ClientDetailPage';
import { ReceivablesPage } from './pages/views/ReceivablesList';
import { PaymentsPage } from './pages/views/PaymentsList';
import { DocumentsPage } from './pages/views/DocumentsList';
import { ExpensesPage } from './pages/views/ExpensesList';
import { ConversionsPage } from './pages/views/ConversionsList';
import { ExpenseGroupsPage } from './pages/views/ExpenseGroupsList';
import { ExpenseGroupDetail } from './pages/views/ExpenseGroupDetail';

/**
 * The portal's routes (hosted-portal.md §7.1, code-based like `src/router.tsx`).
 * The active profile is in the path, so it is deep-linkable and safe across
 * tabs; each list view's filters are its search params. The router is built by
 * a factory and never registered globally: `src` is one TypeScript program, and
 * a global registration would retype the app's own navigation. Every page
 * route hands its component `omitShellOverlay(search)`: the profile drawers'
 * keys belong to the shell, and must never reach a list (MUT-183 R1).
 */

type Raw = Record<string, unknown>;

function parseSignIn(raw: Raw): { next?: string; reason?: ArrivalReason } {
  const next = typeof raw.next === 'string' ? raw.next : undefined;
  const reason = raw.reason === 'expired' || raw.reason === 'signed_out' ? raw.reason : undefined;
  return { ...(next ? { next } : {}), ...(reason ? { reason } : {}) };
}

/**
 * Replace the route's search with `next` (one object, `replace` so filters never
 * pile up in history). The shell's own drawer keys (`?newProfile=`, etc.) ride
 * along unchanged — a page rewriting its own filters must never close a drawer
 * the shell opened (MUT-183 review finding: this used to drop them).
 */
function useReplaceSearch<T extends object>() {
  const navigate = useNavigate();
  return (next: T) =>
    void navigate({ to: '.', search: (prev: Raw) => ({ ...pickShellOverlay(prev), ...next }), replace: true });
}

function RootLayout() {
  // MUT-286 review: a stopped local backend replaces every route until a reload, so no stale record stays usable
  const stopped = useLocalStop();
  return (
    <>
      <SessionBridge />
      {stopped ? <ReloadToContinue stop={stopped} /> : <Outlet />}
    </>
  );
}

/** MUT-149 design D3: the frame itself crashed (no shell to keep), so the whole page asks for a reload. */
function FrameCrash() {
  return <ReloadToContinue stop="CRASH" />;
}

/** A page inside a profile crashed: the card takes the page's place; the shell and its navigation stay. */
const PAGE_CRASH = { errorComponent: CrashCard } as const;

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

  /** A setup link's page (MUT-236): public like sign-in; the token is the fragment, which `SetupPage` strips. */
  const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: SetupPage });

  /** MUT-368: the two self-service doors, public like sign-in; each asks GET /v1/self-service whether it is open. */
  const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/signup', component: SignupPage });
  const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: '/recover', component: RecoverPage });

  /** MUT-291: public like sign-in. The old address's carry-over page, and the new address's receiver. */
  const carryOverRoute = createRoute({ getParentRoute: () => rootRoute, path: '/carry-over', component: CarryOverPage });
  const carryOverReceiveRoute = createRoute({ getParentRoute: () => rootRoute, path: '/carry-over/receive', component: ReceivePage });

  const authedRoute = createRoute({ getParentRoute: () => rootRoute, id: 'authed', component: AuthGate });

  const homeRoute = createRoute({ getParentRoute: () => authedRoute, path: '/', component: HomeRedirect });

  /** Web fallback for the iOS/Android universal link when the app isn't installed (MUT-111). */
  const captureRoute = createRoute({ getParentRoute: () => authedRoute, path: '/capture', component: CaptureRedirect });

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
    ...PAGE_CRASH,
    path: '/',
    validateSearch: parseOverview,
    component: function Overview() {
      return <OverviewPage filters={omitShellOverlay(overviewRoute.useSearch())} setFilters={useReplaceSearch()} />;
    },
  });

  /** MUT-175: Reports — period, day and the All-profiles switch in the URL (DS4). */
  const reportsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/reports',
    validateSearch: parseReports,
    component: function Reports() {
      return <ReportsPage search={omitShellOverlay(reportsRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const clientsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/clients',
    validateSearch: parseClients,
    component: function Clients() {
      return <ClientsPage filters={omitShellOverlay(clientsRoute.useSearch())} setFilters={useReplaceSearch()} />;
    },
  });

  const clientRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/clients/$customerId',
    validateSearch: parseClientDetail,
    component: function Client() {
      const { customerId } = clientRoute.useParams();
      return <ClientDetailPage key={customerId} customerId={customerId} search={omitShellOverlay(clientRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const receivablesRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/receivables',
    validateSearch: parseReceivablesPage,
    component: function Receivables() {
      return <ReceivablesPage search={omitShellOverlay(receivablesRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const paymentsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/payments',
    validateSearch: parsePaymentsPage,
    component: function Payments() {
      return <PaymentsPage search={omitShellOverlay(paymentsRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const documentsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/documents',
    validateSearch: parseDocuments,
    component: function Documents() {
      return <DocumentsPage filters={omitShellOverlay(documentsRoute.useSearch())} setFilters={useReplaceSearch()} />;
    },
  });

  const expensesRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/expenses',
    validateSearch: parseExpensesPage,
    component: function Expenses() {
      return <ExpensesPage filters={omitShellOverlay(expensesRoute.useSearch())} setFilters={useReplaceSearch()} />;
    },
  });

  /** Expenses › Groups (MUT-268, 1A): a tab inside Expenses, so the sidebar's Expenses stays lit. */
  const groupsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/expenses/groups',
    validateSearch: parseGroupsPage,
    component: function Groups() {
      return <ExpenseGroupsPage search={omitShellOverlay(groupsRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const groupRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/expenses/groups/$groupId',
    validateSearch: parseGroupDetail,
    component: function Group() {
      const { groupId } = groupRoute.useParams();
      // Keyed: a different group starts with fresh marks, currency and filter (eng R9)
      return <ExpenseGroupDetail key={groupId} groupId={groupId} search={omitShellOverlay(groupRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const conversionsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/conversions',
    validateSearch: parseConversionsPage,
    component: function Conversions() {
      return <ConversionsPage filters={omitShellOverlay(conversionsRoute.useSearch())} setFilters={useReplaceSearch()} />;
    },
  });

  const routeTree = rootRoute.addChildren([
    signInRoute,
    setupRoute,
    signupRoute,
    recoverRoute,
    carryOverRoute,
    carryOverReceiveRoute,
    authedRoute.addChildren([
      homeRoute,
      captureRoute,
      profileRoute.addChildren([overviewRoute, reportsRoute, clientsRoute, clientRoute, receivablesRoute, paymentsRoute, documentsRoute, expensesRoute, groupsRoute, groupRoute, conversionsRoute]),
    ]),
  ]);

  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: false,
    // MUT-149 (eng R2): the router catches render errors itself, so it reports them, and shows our translated screen
    defaultErrorComponent: FrameCrash,
    defaultOnCatch: (error, info) => reportBoundaryError(error, info?.componentStack ?? undefined),
  });
}

export type PortalRouter = ReturnType<typeof createPortalRouter>;
