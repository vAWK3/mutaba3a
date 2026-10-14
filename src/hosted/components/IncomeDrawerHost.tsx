/* eslint-disable react-refresh/only-export-components */
import type { HostedProfile, SettleReceivableResponse } from '../api/client';
import { incomeAffordancesFor } from '../data/incomeAffordances';
import type { IncomeDrawerSearch } from '../data/filters';
import { IncomeCaptureDrawer } from './IncomeCaptureDrawer';
import { RecordPaymentDrawer } from './RecordPaymentDrawer';

/**
 * The income drawers a page owns (MUT-133, eng review R1): Receivables,
 * Payments and Client detail each mount this once, beside their list, and pass
 * the drawer half of their URL search. A link that asks for a drawer the gate
 * doesn't offer (a Malafat-fed profile, someone else's profile) renders
 * nothing.
 */

export const SETTLE_BUTTON_ATTR = 'data-settle-id';
/** Marks the page header's Add income button, the one that never unmounts. */
export const ADD_BUTTON_ATTR = 'data-income-add';

/**
 * After Add income, focus goes to the header's Add button, which always stays mounted. The drawer
 * would otherwise restore its trigger, and an empty state's Add button is replaced by the first row
 * as soon as the list re-reads (review #4).
 */
export function focusAfterAdd(): void {
  document.querySelector<HTMLElement>(`[${ADD_BUTTON_ATTR}]`)?.focus();
}

/**
 * Where focus goes after a payment, decided before the drawer closes
 * (eng re-review A1, ADR-055 §6). The drawer gives focus back to its trigger on
 * unmount unless something outside already holds it, and a payment that
 * clears the entry removes that trigger with the next refetch. So a full
 * payment moves focus now: to the next row's Record payment, else the page
 * heading. A partial payment leaves the trigger in place and lets the drawer
 * restore it.
 */
export function focusAfterSettle(receivableId: string, result: SettleReceivableResponse): void {
  if (result.receivable.status !== 'PAID') return;
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(`[${SETTLE_BUTTON_ATTR}]`));
  const index = buttons.findIndex((button) => button.getAttribute(SETTLE_BUTTON_ATTR) === receivableId);
  const next = index >= 0 ? buttons[index + 1] : undefined;
  if (next) {
    next.focus();
    return;
  }
  const heading = document.querySelector<HTMLElement>('.hp-page-header h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

export interface IncomeDrawerHostProps {
  profile: HostedProfile;
  drawer: IncomeDrawerSearch;
  onClose: () => void;
  /** Client detail prefills the client. */
  defaultCustomerId?: string;
}

export function IncomeDrawerHost({ profile, drawer, onClose, defaultCustomerId }: IncomeDrawerHostProps) {
  const { kinds, canSettle } = incomeAffordancesFor(profile);
  if (drawer.settle && canSettle) {
    const receivableId = drawer.settle;
    return (
      <RecordPaymentDrawer
        // One drawer state per receivable: an amount typed for one row never carries to another.
        key={receivableId}
        profile={profile}
        receivableId={receivableId}
        onClose={onClose}
        onSettled={(result) => {
          focusAfterSettle(receivableId, result);
          onClose();
        }}
      />
    );
  }
  if (drawer.newIncome && kinds.length > 0) {
    return (
      <IncomeCaptureDrawer profile={profile} initialKind={drawer.newIncome} defaultCustomerId={defaultCustomerId} onClose={onClose} onSaved={focusAfterAdd} />
    );
  }
  return null;
}
