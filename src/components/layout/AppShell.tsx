import { type ReactNode, useEffect } from "react";
import { SidebarNav } from "./SidebarNav";
import { TransactionDrawer } from "../drawers/TransactionDrawer";
import { ClientDrawer } from "../drawers/ClientDrawer";
import { ProjectDrawer } from "../drawers/ProjectDrawer";
import { BusinessProfileDrawer } from "../drawers/BusinessProfileDrawer";
import { DocumentDrawer } from "../drawers/DocumentDrawer";
import { ExpenseDrawer } from "../drawers/ExpenseDrawer";
import { RetainerDrawer } from "../drawers/RetainerDrawer";
import { RetainerMatchingDrawer } from "../drawers/RetainerMatchingDrawer";
import { WelcomeModal, DemoSeedModal } from "../modals";
import { MacDownloadBanner } from "../ui/MacDownloadBanner";
import { FxRateBanner } from "../ui/FxRateBanner";
import { DemoBanner } from "../ui/DemoBanner";
// import { UpdateBanner } from '../ui/UpdateBanner';
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
    transactionDrawer,
    clientDrawer,
    projectDrawer,
    businessProfileDrawer,
    documentDrawer,
    expenseDrawer,
    retainerDrawer,
    retainerMatchingDrawer,
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

      {transactionDrawer.isOpen && <TransactionDrawer />}
      {clientDrawer.isOpen && <ClientDrawer />}
      {projectDrawer.isOpen && <ProjectDrawer />}
      {businessProfileDrawer.isOpen && <BusinessProfileDrawer />}
      {documentDrawer.isOpen && <DocumentDrawer />}
      {expenseDrawer.isOpen && <ExpenseDrawer />}
      {retainerDrawer.isOpen && <RetainerDrawer />}
      {retainerMatchingDrawer.isOpen && <RetainerMatchingDrawer />}

      <FxRateBanner />
      <MacDownloadBanner />

      {/* <UpdateBanner /> */}
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
