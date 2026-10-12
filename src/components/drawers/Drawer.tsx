import type { ReactNode } from 'react';
import { useT } from '../../lib/i18n';
import { DrawerFrame } from '../ui/drawer/DrawerFrame';

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** The local app's drawer: the shared frame (MUT-80) with the app's close label. */
export function Drawer(props: DrawerProps) {
  const t = useT();
  return <DrawerFrame {...props} closeLabel={t('common.close')} />;
}
