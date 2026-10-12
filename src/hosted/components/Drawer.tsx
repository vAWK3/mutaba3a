import type { ReactNode } from 'react';
import { DrawerFrame } from '../../components/ui/drawer/DrawerFrame';

/**
 * The portal's slide-over (MUT-44 design brief §6a point 5). The portal may
 * not import src/components/drawers/** ("the portal has its own shell and no
 * drawers", hosted-portal.md §2), so both builds render the shared
 * `DrawerFrame` from `components/ui` (MUT-80): the same classes, springs,
 * drag and focus handling as the local app's drawer (brief HP1).
 */
export interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
}

export function Drawer(props: DrawerProps) {
  return <DrawerFrame {...props} />;
}
