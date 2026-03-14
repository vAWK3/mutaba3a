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
import { WelcomeModal, DemoSeedModal } from "../modals";
import { MacDownloadBanner } from "../ui/MacDownloadBanner";
import { FxRateBanner } from "../ui/FxRateBanner";
import { DemoBanner } from "../ui/DemoBanner";
import { InlineErrorBoundary } from "../ui/ErrorBoundary";
import { UpdateBanner } from '../ui/UpdateBanner';
import {
  ConflictBanner,
  ExportBundleModal,
  ImportBundleModal,
  PairingModal,
} from "../sync";
import { useDrawerStore } from "../../lib/stores";
import { initializeSync } from "../../sync";
import { useDemoStore, DEMO_QUERY_PARAM } from "../../demo";

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
  } = useDrawerStore();

  const { showConfirmModal, setShowConfirmModal, isActive } = useDemoStore();

  // Initialize sync system on app load
  useEffect(() => {
    initializeSync().catch((err) => {
      console.error("Failed to initialize sync:", err);
    });
  }, []);

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
        <ConflictBanner />
        {children}
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
          />
        </InlineErrorBoundary>
      )}
      {planAssumptionDrawer.isOpen && (
        <InlineErrorBoundary>
          <PlanAssumptionDrawer />
        </InlineErrorBoundary>
      )}

      <FxRateBanner />
      <MacDownloadBanner />

      <UpdateBanner />
      <ExportBundleModal />
      <ImportBundleModal />
      <PairingModal />
      <WelcomeModal />

      {showConfirmModal && (
        <DemoSeedModal onClose={() => setShowConfirmModal(false)} />
      )}
    </div>
  );
}
