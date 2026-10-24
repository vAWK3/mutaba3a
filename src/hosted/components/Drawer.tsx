import type { ReactNode } from 'react';
import { useT } from '../../lib/i18n/core';
import { DrawerFrame } from '../../components/ui/drawer/DrawerFrame';
import { LockIcon } from './Icons';

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
  /**
   * MUT-361 (review R3): a write drawer on a profile the lapse gate holds read-only. It still opens (the details are a
   * read), with a note saying why, and no footer: Save and Delete are gone. The drawer itself wraps its form fields in
   * `ReadOnlyFields`, so reads inside it (a receipt's Download) keep working.
   */
  readOnly?: boolean;
}

export function Drawer({ readOnly = false, footer, children, ...frame }: DrawerProps) {
  return (
    <DrawerFrame {...frame} footer={readOnly ? undefined : footer}>
      {readOnly && <ReadOnlyDrawerNote />}
      {children}
    </DrawerFrame>
  );
}

function ReadOnlyDrawerNote() {
  const t = useT();
  return (
    <p className="hp-readonly" role="note">
      <LockIcon />
      <span>{t('hosted.billing.gate.drawerNote')}</span>
    </p>
  );
}

/** MUT-361: a drawer's form fields, disabled together while the profile is read-only. Layout-neutral otherwise. */
export function ReadOnlyFields({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <fieldset className="hp-readonly-fields" disabled>
      {children}
    </fieldset>
  );
}
