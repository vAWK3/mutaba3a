/* eslint-disable react-refresh/only-export-components */
import { useRef, type ReactNode, type RefObject } from 'react';
import { Navigate, Outlet, createRootRoute, createRoute, createRouter, useNavigate, type RouterHistory } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { SignInPage, type ArrivalReason } from './pages/auth/SignInPage';
import { SetupPage } from './pages/auth/SetupPage';
import { SignupPage } from './pages/auth/SignupPage';
import { RecoverPage } from './pages/auth/RecoverPage';
import { CarryOverPage } from './pages/carry-over/CarryOverPage';
import { ReceivePage } from './pages/carry-over/ReceivePage';
import { AuthGate, CaptureRedirect, HomeRedirect, ProfileLayout, RedirectToSignIn } from './session/AuthGate';
import { useIsLocalMode, useMode } from './session/mode';
import { WelcomePage } from './pages/auth/WelcomePage';
import { SessionBridge } from './session/SessionBridge';
import { useLocalStop } from './session/localStop';
import { ReloadToContinue } from './pages/auth/BootScreens';
import { CrashCard } from './components/QueryView';
import { reportBoundaryError } from './observability/errorReporting';
import { omitShellOverlay, parseClientDetail, parseGlance, parseClients, parseConversionsPage, parseDocuments, parseExpensesPage, parseGroupDetail, parseGroupsPage, parseOverview, parsePaymentsPage, parseReceiptReview, parseReceiptsPage, parseReceivablesPage, parseReports, pickShellOverlay } from './data/filters';
import { OverviewPage } from './pages/views/OverviewPage';
import { ReportsPage } from './pages/views/ReportsPage';
import { GlancePage } from './pages/views/GlancePage';
import { glanceShellProfile } from './data/verdict';
import { ClientsPage } from './pages/views/ClientsPage';
import { ClientDetailPage } from './pages/views/ClientDetailPage';
import { ReceivablesPage } from './pages/views/ReceivablesList';
import { PaymentsPage } from './pages/views/PaymentsList';
import { DocumentsPage } from './pages/views/DocumentsList';
import { ExpensesPage } from './pages/views/ExpensesList';
import { ConversionsPage } from './pages/views/ConversionsList';
import { ExpenseGroupsPage } from './pages/views/ExpenseGroupsList';
import { ExpenseGroupDetail } from './pages/views/ExpenseGroupDetail';
import { ReceiptsGallery } from './pages/views/ReceiptsGallery';
import { ReceiptReviewPage } from './pages/views/ReceiptReview';
import { YouPage } from './pages/you/YouPage';
import { ConsentPage } from './pages/connect/ConsentPage';
import { parseConsentSearch } from './pages/connect/consentSearch';
import { HostedShell } from './shell/HostedShell';
import { supportsViewTransitionTypes, viewTransitionOption } from './shell/pageMotion';
import { YOU_PARTS, parseYouSearch, youPath } from './shell/youRoutes';
import { useMe, useProfile } from './session/me';
import { useIsOperator } from './session/features';
import { OperatorLayout } from './pages/operator/OperatorLayout';
import { OperatorSignupsPage } from './pages/operator/OperatorSignupsPage';
import { OperatorAccountsPage } from './pages/operator/OperatorAccountsPage';
import { OperatorAccountPage } from './pages/operator/OperatorAccountPage';
import { OperatorFirmsPage } from './pages/operator/OperatorFirmsPage';

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

/** `/welcome` (MUT-513): "Continue on this device" when this device is already chosen; signed in, back to the app. */
function WelcomeRoute() {
  const mode = useMode();
  if (mode === 'remote') return <Navigate to="/" replace />;
  return <WelcomePage variant={mode === 'local' ? 'reopened' : 'first'} />;
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

  /** A setup link's page (MUT-236): public like sign-in; the token is the fragment, which `SetupPage` strips. */
  const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: SetupPage });

  /** MUT-368: the two self-service doors, public like sign-in; each asks GET /v1/self-service whether it is open. */
  const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/signup', component: SignupPage });
  const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: '/recover', component: RecoverPage });

  /** MUT-291: public like sign-in. The old address's carry-over page, and the new address's receiver. */
  const carryOverRoute = createRoute({ getParentRoute: () => rootRoute, path: '/carry-over', component: CarryOverPage });
  const carryOverReceiveRoute = createRoute({ getParentRoute: () => rootRoute, path: '/carry-over/receive', component: ReceivePage });

  /** MUT-513: the welcome, reopened from You › Account on this device. Signed in, there's nothing to choose. */
  const welcomeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/welcome', component: WelcomeRoute });

  const authedRoute = createRoute({ getParentRoute: () => rootRoute, id: 'authed', component: AuthGate });

  const homeRoute = createRoute({ getParentRoute: () => authedRoute, path: '/', component: HomeRedirect });

  /** Web fallback for the iOS/Android universal link when the app isn't installed (MUT-111). */
  const captureRoute = createRoute({ getParentRoute: () => authedRoute, path: '/capture', component: CaptureRedirect });

  /** MUT-434: an agent asking to connect lands here from /oauth/authorize; signed in, no profile. */
  const connectApproveRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: '/connect/approve',
    validateSearch: parseConsentSearch,
    component: function ConnectApprove() {
      return <ConsentPage search={connectApproveRoute.useSearch()} />;
    },
  });

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

  /** Expenses › Groups (MUT-268, 1A): a tab inside Expenses, so the pill's Spent stays lit. */
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

  /** Expenses › Receipts (MUT-260 D1): the library's gallery, a tab inside Expenses like Groups. */
  const receiptsRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/expenses/receipts',
    validateSearch: parseReceiptsPage,
    component: function Receipts() {
      return <ReceiptsGallery search={omitShellOverlay(receiptsRoute.useSearch())} setSearch={useReplaceSearch()} />;
    },
  });

  const receiptRoute = createRoute({
    getParentRoute: () => profileRoute,
    ...PAGE_CRASH,
    path: '/expenses/receipts/$receiptId',
    validateSearch: parseReceiptReview,
    component: function Receipt() {
      const { receiptId } = receiptRoute.useParams();
      // Keyed: another receipt starts a fresh form and attempt key (A2)
      return <ReceiptReviewPage key={receiptId} receiptId={receiptId} search={omitShellOverlay(receiptRoute.useSearch())} setSearch={useReplaceSearch()} />;
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

  /**
   * MUT-448: the Glance, account-level Reports outside any profile (eng P1). The shell keeps a profile so its pill and
   * island stay (D8): the one the Reports icon was pressed on (`back`), unless it is locked or unreadable.
   */
  const glanceRoute = createRoute({
    getParentRoute: () => authedRoute,
    ...PAGE_CRASH,
    path: '/reports',
    validateSearch: parseGlance,
    component: function Glance() {
      const search = parseGlance(omitShellOverlay(glanceRoute.useSearch()));
      const me = useMe();
      const shell = glanceShellProfile(me.profiles, search.back?.split('/')[2], me);
      return (
        <HostedShell profile={shell}>
          <GlancePage search={search} setSearch={useReplaceSearch()} shell={shell} />
        </HostedShell>
      );
    },
  });

  /**
   * MUT-425: the You page, one route per part, inside the open profile (`/p/:id/you…`) and without one (`/you…`, for
   * a person with no profile or on one they lost, eng D3). `from` is the only search the page reads (eng D3), and it
   * is parsed again at the page: TanStack carries every raw key into a route's search, so a `?from=bogus` would
   * otherwise reach the page past `validateSearch` (the same reason pages take `omitShellOverlay(search)`).
   */
  const youRoutes = YOU_PARTS.map((part) => {
    const path = youPath(null, part);
    const inProfile = createRoute({
      getParentRoute: () => profileRoute,
      ...PAGE_CRASH,
      path,
      validateSearch: parseYouSearch,
      component: function YouInProfile() {
        return <YouPage part={part} profile={useProfile()} search={parseYouSearch(inProfile.useSearch())} />;
      },
    });
    const noProfile = createRoute({
      getParentRoute: () => authedRoute,
      path,
      validateSearch: parseYouSearch,
      component: function YouWithoutProfile() {
        return (
          <HostedShell profile={null}>
            <YouPage part={part} profile={null} search={parseYouSearch(noProfile.useSearch())} />
          </HostedShell>
        );
      },
    });
    return { inProfile, noProfile };
  });

  /**
   * MUT-460 (ADR-213, design 6A): the operator console, outside any profile. Only an operator (/v1/me says so) sees it;
   * anyone else gets the not-found answer every unknown path gets, and the server's gate refuses them regardless.
   */
  const operatorRoute = createRoute({ getParentRoute: () => authedRoute, path: '/operator', component: () => <Navigate to="/operator/signups" replace /> });
  /** Every operator page: signed out it asks for a sign-in (local mode never does, 2A); a non-operator goes Home. */
  function OperatorPage({ children }: { children: (heading: RefObject<HTMLHeadingElement | null>) => ReactNode }) {
    const operator = useIsOperator();
    const local = useIsLocalMode();
    const heading = useRef<HTMLHeadingElement>(null);
    if (local) return <RedirectToSignIn />;
    if (!operator) return <Navigate to="/" replace />;
    return (
      <HostedShell profile={null}>
        <OperatorLayout headingRef={heading}>{children(heading)}</OperatorLayout>
      </HostedShell>
    );
  }

  const operatorSignupsRoute = createRoute({
    getParentRoute: () => authedRoute,
    ...PAGE_CRASH,
    path: '/operator/signups',
    component: () => <OperatorPage>{(heading) => <OperatorSignupsPage headingRef={heading} />}</OperatorPage>,
  });

  /** MUT-461 (17A): find an account by email; the address stays in the URL. */
  const operatorAccountsRoute = createRoute({
    getParentRoute: () => authedRoute,
    ...PAGE_CRASH,
    path: '/operator/accounts',
    validateSearch: (search: Record<string, unknown>): { email?: string } => (typeof search.email === 'string' && search.email ? { email: search.email } : {}),
    component: function OperatorAccounts() {
      const { email = '' } = operatorAccountsRoute.useSearch();
      const navigate = useNavigate();
      return (
        <OperatorPage>
          {/* The key starts the field over when Back changes the address. */}
          {() => <OperatorAccountsPage key={email} email={email} onSearch={(next) => void navigate({ to: '/operator/accounts', search: { email: next } })} />}
        </OperatorPage>
      );
    },
  });

  /** MUT-461 (5A): one account and its actions. */
  const operatorAccountRoute = createRoute({
    getParentRoute: () => authedRoute,
    ...PAGE_CRASH,
    path: '/operator/accounts/$userId',
    // MUT-462 (14A): `?grant=new` opens the grant drawer.
    validateSearch: (search: Record<string, unknown>): { grant?: 'new' } => (search.grant === 'new' ? { grant: 'new' } : {}),
    component: function OperatorAccount() {
      const { userId } = operatorAccountRoute.useParams();
      const { grant } = operatorAccountRoute.useSearch();
      const navigate = useNavigate();
      const onGrantOpen = (open: boolean) => void navigate({ to: '/operator/accounts/$userId', params: { userId }, search: open ? { grant: 'new' } : {} });
      return <OperatorPage>{() => <OperatorAccountPage key={userId} userId={userId} grantOpen={grant === 'new'} onGrantOpen={onGrantOpen} />}</OperatorPage>;
    },
  });

  /** MUT-462 (16A): pending firm requests, enable with owners or decline. */
  const operatorFirmsRoute = createRoute({
    getParentRoute: () => authedRoute,
    ...PAGE_CRASH,
    path: '/operator/firms',
    component: () => <OperatorPage>{(heading) => <OperatorFirmsPage headingRef={heading} />}</OperatorPage>,
  });

  const routeTree = rootRoute.addChildren([
    signInRoute,
    setupRoute,
    signupRoute,
    recoverRoute,
    carryOverRoute,
    carryOverReceiveRoute,
    welcomeRoute,
    authedRoute.addChildren([
      homeRoute,
      captureRoute,
      connectApproveRoute,
      glanceRoute,
      operatorRoute,
      operatorSignupsRoute,
      operatorAccountsRoute,
      operatorAccountRoute,
      operatorFirmsRoute,
      ...youRoutes.map((route) => route.noProfile),
      profileRoute.addChildren([
        overviewRoute,
        reportsRoute,
        clientsRoute,
        clientRoute,
        receivablesRoute,
        paymentsRoute,
        documentsRoute,
        expensesRoute,
        groupsRoute,
        groupRoute,
        receiptsRoute,
        receiptRoute,
        conversionsRoute,
        ...youRoutes.map((route) => route.inProfile),
      ]),
    ]),
  ]);

  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: false,
    // MUT-426 (eng D6): pages slide by depth as typed view transitions; unset where types aren't supported
    defaultViewTransition: viewTransitionOption(supportsViewTransitionTypes(globalThis.CSS?.supports?.bind(globalThis.CSS))),
    // MUT-149 (eng R2): the router catches render errors itself, so it reports them, and shows our translated screen
    defaultErrorComponent: FrameCrash,
    defaultOnCatch: (error, info) => reportBoundaryError(error, info?.componentStack ?? undefined),
  });
}

export type PortalRouter = ReturnType<typeof createPortalRouter>;
