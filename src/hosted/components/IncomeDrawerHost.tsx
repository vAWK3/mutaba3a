/* eslint-disable react-refresh/only-export-components */
import { useNavigate } from '@tanstack/react-router';
import type { HostedProfile, SettleReceivableResponse } from '../api/client';
import { incomeAffordancesFor, redateAffordancesFor } from '../data/incomeAffordances';
import type { IncomeDrawerSearch } from '../data/filters';
import { IncomeCaptureDrawer } from './IncomeCaptureDrawer';
import { RecordPaymentDrawer } from './RecordPaymentDrawer';
import { useMe } from '../session/me';
import { RedateDrawer } from './RedateDrawer';

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
  /** MUT-224: replace the drawer state, e.g. a settled entry's payment line opens `?payment=`. */
  onOpen: (next: IncomeDrawerSearch) => void;
  /** MUT-224: where "See this client's payments" goes; default: the client's Payments tab. */
  onSeePayments?: (customerId: string) => void;
}

/**
 * One drawer at a time, first match wins when a link carries several: settle, then Add income, then the re-date
 * drawers (eng review: precedence). A drawer the gate doesn't offer here renders nothing.
 */
export function IncomeDrawerHost({ profile, drawer, onClose, defaultCustomerId, onOpen, onSeePayments }: IncomeDrawerHostProps) {
  const { kinds, canSettle } = incomeAffordancesFor(profile);
  const redate = redateAffordancesFor(profile);
  const navigate = useNavigate();
  const userId = useMe().user.id;
  const seePayments = onSeePayments ?? ((customerId: string) => void navigate({ to: `/p/${profile.id}/clients/${customerId}`, search: { tab: 'payments' } } as never));
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
  const redateTarget = drawer.income && redate.owed ? { kind: 'owed' as const, id: drawer.income } : drawer.payment && redate.payments ? { kind: 'payment' as const, id: drawer.payment } : null;
  if (redateTarget) {
    return (
      <RedateDrawer
        // One drawer state per record: a date typed for one row never carries to another.
        key={`${redateTarget.kind}:${redateTarget.id}`}
        kind={redateTarget.kind}
        profile={profile}
        id={redateTarget.id}
        userId={userId}
        onClose={onClose}
        onOpenPayment={(paymentId) => onOpen({ payment: paymentId })}
        onSeePayments={seePayments}
      />
    );
  }
  return null;
}
