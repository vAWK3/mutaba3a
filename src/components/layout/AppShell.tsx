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
import { WelcomeModal } from "../modals";
import { MacDownloadBanner } from "../ui/MacDownloadBanner";
import { FxRateBanner } from "../ui/FxRateBanner";
// import { UpdateBanner } from '../ui/UpdateBanner';
import {
  ConflictBanner,
  ExportBundleModal,
  ImportBundleModal,
  PairingModal,
} from "../sync";
import { useDrawerStore } from "../../lib/stores";
import { initializeSync } from "../../sync";

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

  // Initialize sync system on app load
  useEffect(() => {
    initializeSync().catch((err) => {
      console.error("Failed to initialize sync:", err);
    });
  }, []);

  return (
    <div className="app-shell">
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
    </div>
  );
}
