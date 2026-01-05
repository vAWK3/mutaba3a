import { type ReactNode } from 'react';
import { SidebarNav } from './SidebarNav';
import { TransactionDrawer } from '../drawers/TransactionDrawer';
import { ClientDrawer } from '../drawers/ClientDrawer';
import { ProjectDrawer } from '../drawers/ProjectDrawer';
import { MacDownloadBanner } from '../ui/MacDownloadBanner';
import { FxRateBanner } from '../ui/FxRateBanner';
import { useDrawerStore } from '../../lib/stores';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { transactionDrawer, clientDrawer, projectDrawer } = useDrawerStore();

  return (
    <div className="app-shell">
      <SidebarNav />
      <main className="main-content">{children}</main>

      {transactionDrawer.isOpen && <TransactionDrawer />}
      {clientDrawer.isOpen && <ClientDrawer />}
      {projectDrawer.isOpen && <ProjectDrawer />}

      <FxRateBanner />
      <MacDownloadBanner />
    </div>
  );
}
