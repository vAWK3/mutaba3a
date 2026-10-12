import { type ReactNode, useEffect } from "react";
import { SidebarNav } from "./SidebarNav";
import { IncomeDrawer } from "../drawers/IncomeDrawer";
import { ClientDrawer } from "../drawers/ClientDrawer";
import { ProjectDrawer } from "../drawers/ProjectDrawer";
import { BusinessProfileDrawer } from "../drawers/BusinessProfileDrawer";
import { DocumentDrawer } from "../drawers/DocumentDrawer";
import { ExpenseDrawer } from "../drawers/ExpenseDrawer";
import { RetainerDrawer } from "../drawers/RetainerDrawer";
import { RetainerMatchingDrawer } from "../drawers/RetainerMatchingDrawer";
import { PartialPaymentDrawer } from "../drawers/PartialPaymentDrawer";
import { PlanAssumptionDrawer } from "../drawers/PlanAssumptionDrawer";
import { OrphanedRecordsDrawer } from "../drawers/OrphanedRecordsDrawer";
import { WelcomeModal, DemoSeedModal, MigrationWizard } from "../modals";
import { OrphanedRecordsBanner } from "./OrphanedRecordsBanner";
import { MacDownloadBanner } from "../ui/MacDownloadBanner";
import { DemoBanner } from "../ui/DemoBanner";
import { SampleDataBar } from "../ui/SampleDataBar";
import { useT } from "../../lib/i18n";
import { useVisitorSampleEntry } from "../../demo/useVisitorSample";
import { useSampleSessionStore } from "../../demo/sampleSessionStore";
import { InlineErrorBoundary } from "../ui/ErrorBoundary";
import { UpdateBanner } from '../ui/UpdateBanner';
import { useDrawerStore } from "../../lib/stores";
import { useDemoStore, DEMO_QUERY_PARAM } from "../../demo";
import { FeatureNoticeBanner } from "./FeatureNoticeBanner";
import { useLeaveDisabledArea } from "../../lib/features/routeGuard";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const {
    incomeDrawer,
    clientDrawer,
    projectDrawer,
    businessProfileDrawer,
    documentDrawer,
    expenseDrawer,
    retainerDrawer,
    retainerMatchingDrawer,
    partialPaymentDrawer,
    closePartialPaymentDrawer,
    planAssumptionDrawer,
    orphanedRecordsDrawer,
  } = useDrawerStore();

  const { showConfirmModal, setShowConfirmModal, isActive } = useDemoStore();

  // A page whose optional area is switched off sends the user home (MUT-15)
  useLeaveDisabledArea();

  // The landing page's "Open the web app" opens a sample business (MUT-78)
  const t = useT();
  useVisitorSampleEntry();
  const isPreparingSample = useSampleSessionStore((s) => s.status === "preparing");

  // Detect ?demo=1 query parameter to trigger demo mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(DEMO_QUERY_PARAM) === "1") {
      setShowConfirmModal(true);
      // Clean URL by removing the demo parameter
      params.delete(DEMO_QUERY_PARAM);
      const newUrl =
        params.toString().length > 0
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, [setShowConfirmModal]);

  // Add body class when demo mode is active (for CSS :has() fallback)
  useEffect(() => {
    if (isActive) {
      document.body.classList.add("demo-mode-active");
    } else {
      document.body.classList.remove("demo-mode-active");
    }
    return () => {
      document.body.classList.remove("demo-mode-active");
    };
  }, [isActive]);

  return (
    <div className="app-shell">
      <DemoBanner />
      <SidebarNav />
      <main className="main-content">
        <SampleDataBar />
        <OrphanedRecordsBanner />
        <FeatureNoticeBanner />
        {isPreparingSample ? (
          <div className="sample-preparing" role="status" aria-busy="true">
            {t("sample.preparing")}
          </div>
        ) : (
          children
        )}
        {/* Bottom bars sit in flow below the page: nothing floats over content (MUT-79) */}
        <MacDownloadBanner />
        <UpdateBanner />
      </main>

      {incomeDrawer.isOpen && (
        <InlineErrorBoundary>
          <IncomeDrawer />
        </InlineErrorBoundary>
      )}
      {clientDrawer.isOpen && (
        <InlineErrorBoundary>
          <ClientDrawer />
        </InlineErrorBoundary>
      )}
      {projectDrawer.isOpen && (
        <InlineErrorBoundary>
          <ProjectDrawer />
        </InlineErrorBoundary>
      )}
      {businessProfileDrawer.isOpen && (
        <InlineErrorBoundary>
          <BusinessProfileDrawer />
        </InlineErrorBoundary>
      )}
      {documentDrawer.isOpen && (
        <InlineErrorBoundary>
          <DocumentDrawer />
        </InlineErrorBoundary>
      )}
      {expenseDrawer.isOpen && (
        <InlineErrorBoundary>
          <ExpenseDrawer />
        </InlineErrorBoundary>
      )}
      {retainerDrawer.isOpen && (
        <InlineErrorBoundary>
          <RetainerDrawer />
        </InlineErrorBoundary>
      )}
      {retainerMatchingDrawer.isOpen && (
        <InlineErrorBoundary>
          <RetainerMatchingDrawer />
        </InlineErrorBoundary>
      )}
      {partialPaymentDrawer.isOpen && partialPaymentDrawer.transactionId && (
        <InlineErrorBoundary>
          <PartialPaymentDrawer
            transactionId={partialPaymentDrawer.transactionId}
            onClose={closePartialPaymentDrawer}
            onRecorded={partialPaymentDrawer.onRecorded}
          />
        </InlineErrorBoundary>
      )}
      {planAssumptionDrawer.isOpen && (
        <InlineErrorBoundary>
          <PlanAssumptionDrawer />
        </InlineErrorBoundary>
      )}
      {orphanedRecordsDrawer.isOpen && (
        <InlineErrorBoundary>
          <OrphanedRecordsDrawer />
        </InlineErrorBoundary>
      )}

      <WelcomeModal />
      <MigrationWizard />

      {showConfirmModal && (
        <DemoSeedModal onClose={() => setShowConfirmModal(false)} />
      )}
    </div>
  );
}
