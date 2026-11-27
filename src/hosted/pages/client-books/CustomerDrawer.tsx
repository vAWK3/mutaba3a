import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { mapDeskError, type DeskBanner } from '../../components/accountantErrors';
import { CodeReveal } from '../../components/CodeReveal';
import { Drawer } from '../../components/Drawer';
import { InPlaceConfirm } from '../../components/InPlaceConfirm';
import { ProfileBanner } from '../../components/ProfileBanner';
import { ACCOUNTANT_CUSTOMERS_KEY, useChangeCustomerEmail, useReissueLink } from '../../data/accountantCustomersQueries';
import { useAttemptKey } from '../../data/attemptKey';
import { DeskBadge } from './DeskBadge';
import type { DeskRow } from './deskRules';
import { TakeCardPane } from './TakeCardPane';

/**
 * MUT-768 (accountant channel, DR-3): one customer's drawer on `?customer=`. Resend link and New code (one server
 * action: a fresh link and a fresh code), Change email (confirmed in place, naming what stops working) and Take card
 * (its own pane, `&pane=card`). Setup actions exist only while the customer has not claimed; Take card only while they
 * have not paid. A refusal is a banner at the top of the body, and one that means the list is stale re-reads it.
 */
const UNCLAIMED = new Set(['awaiting_claim', 'link_expired', 'code_locked']);

interface Reveal {
  email: string;
  claimCode?: string | undefined;
}

export interface CustomerDrawerProps {
  row: DeskRow;
  pane: 'card' | undefined;
  onClose: () => void;
  onPane: (pane: 'card' | undefined) => void;
}

export function CustomerDrawer({ row, pane, onClose, onPane }: CustomerDrawerProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const customer = row.customer!;
  const reissue = useReissueLink();
  const changeEmail = useChangeCustomerEmail();
  const reissueAttempt = useAttemptKey();
  const emailAttempt = useAttemptKey();
  const [banner, setBanner] = useState<DeskBanner | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [changing, setChanging] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  const unclaimed = UNCLAIMED.has(customer.state);
  const canTakeCard = !customer.paid && row.state !== 'ended';

  const fail = (error: unknown) => {
    const mapped = mapDeskError(error);
    if (mapped.refetchDesk) void queryClient.invalidateQueries({ queryKey: ACCOUNTANT_CUSTOMERS_KEY });
    setBanner(mapped.banner);
    setReveal(null);
  };

  /** Resend link and New code are the same call. */
  const newLink = async () => {
    setBanner(null);
    try {
      const link = await reissue.mutateAsync({ userId: customer.userId, idempotencyKey: reissueAttempt.keyFor({ userId: customer.userId }) });
      reissueAttempt.succeeded();
      setReveal({ email: link.email, claimCode: link.claimCode });
    } catch (error) {
      fail(error);
    }
  };

  const submitEmail = async () => {
    const next = email.trim().toLowerCase();
    if (!next) return setEmailError('hosted.desk.required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setEmailError('hosted.desk.invalidEmail');
    setEmailError(null);
    setBanner(null);
    try {
      const link = await changeEmail.mutateAsync({ userId: customer.userId, email: next, idempotencyKey: emailAttempt.keyFor({ userId: customer.userId, email: next }) });
      emailAttempt.succeeded();
      setChanging(false);
      setEmail('');
      setReveal({ email: link.email, claimCode: link.claimCode });
    } catch (error) {
      fail(error);
    }
  };

  const title = t('hosted.desk.customerDrawer.title');
  const closeLabel = t('common.close');

  return (
    <Drawer title={title} onClose={onClose} closeLabel={closeLabel}>
      {banner && <ProfileBanner banner={banner} />}
      <p>
        <strong dir="auto">{row.name}</strong>
        <br />
        <bdi dir="auto">{row.ownerName}</bdi> · <bdi dir="ltr">{customer.email}</bdi>
      </p>
      <p>
        <DeskBadge state={row.state} />
      </p>
      {pane === 'card' && canTakeCard ? (
        <TakeCardPane userId={customer.userId} onBack={() => onPane(undefined)} />
      ) : (
        <>
          {reveal && (
            <>
              <p className="hp-muted" dir="auto">
                {t('hosted.desk.customerDrawer.sent', { email: reveal.email })}
              </p>
              {reveal.claimCode && <CodeReveal code={reveal.claimCode} label={t('hosted.desk.customerDrawer.code')} />}
            </>
          )}
          <div className="hp-desk-next">
            {unclaimed && (
              <>
                <Button type="button" variant="ghost" onClick={() => void newLink()} isLoading={reissue.isPending}>
                  {t('hosted.desk.next.resend')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void newLink()} isLoading={reissue.isPending}>
                  {t('hosted.desk.next.newCode')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setChanging(true)}>
                  {t('hosted.desk.customerDrawer.changeEmail')}
                </Button>
              </>
            )}
            {canTakeCard && (
              <Button type="button" variant="ghost" onClick={() => onPane('card')}>
                {t('hosted.desk.next.takeCard')}
              </Button>
            )}
          </div>
          {unclaimed && changing && (
            <div>
              <div className="form-group">
                <label className="form-label" htmlFor="hosted-desk-new-email">
                  {t('hosted.desk.customerDrawer.newEmail')}
                </label>
                <input
                  id="hosted-desk-new-email"
                  className="input"
                  dir="ltr"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  aria-invalid={emailError !== null}
                  aria-describedby={emailError ? 'hosted-desk-new-email-error' : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {emailError && (
                  <p className="form-error" id="hosted-desk-new-email-error">
                    {t(emailError)}
                  </p>
                )}
              </div>
              <InPlaceConfirm
                appearance="box"
                variant="primary"
                message={t('hosted.desk.customerDrawer.changeWarn')}
                cancelLabel={t('common.cancel')}
                confirmLabel={t('hosted.desk.customerDrawer.change')}
                busy={changeEmail.isPending}
                onCancel={() => {
                  setChanging(false);
                  setEmailError(null);
                }}
                onConfirm={() => void submitEmail()}
              />
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
