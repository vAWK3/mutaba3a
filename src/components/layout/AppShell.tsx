import { type ReactNode, useEffect } from 'react';
import { SidebarNav } from './SidebarNav';
import { TransactionDrawer } from '../drawers/TransactionDrawer';
import { ClientDrawer } from '../drawers/ClientDrawer';
import { ProjectDrawer } from '../drawers/ProjectDrawer';
import { MacDownloadBanner } from '../ui/MacDownloadBanner';
import { FxRateBanner } from '../ui/FxRateBanner';
import { UpdateBanner } from '../ui/UpdateBanner';
import { ConflictBanner, ExportBundleModal, ImportBundleModal, PairingModal } from '../sync';
import { useDrawerStore } from '../../lib/stores';
import { initializeSync } from '../../sync';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { transactionDrawer, clientDrawer, projectDrawer } = useDrawerStore();

  // Initialize sync system on app load
  useEffect(() => {
    initializeSync().catch((err) => {
      console.error('Failed to initialize sync:', err);
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

      <FxRateBanner />
      <MacDownloadBanner />
      <UpdateBanner />
      <ExportBundleModal />
      <ImportBundleModal />
      <PairingModal />
    </div>
  );
}
