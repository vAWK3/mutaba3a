import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { copyToClipboard } from '../../../lib/utils';
import type { HostedProfile, ShareLinkCreated, ShareLinkPeriod } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { Drawer, ReadOnlyFields } from '../../components/Drawer';
import { AlertIcon } from '../../components/Icons';
import { Scene } from '../../components/Scene';
import { api } from '../../api/client';
import { refetchAfterRefusal, shareLinksKey } from '../../data/sharingQueries';
import { useWritableFor } from '../../session/me';
import { SHARE_DAYS, SHARE_PERIODS, dayIn, linkErrorOf, monthsLabel, periodEvent, periodRange, pinOf, rangeLine, shortDay, type Line, type ShareDays } from './sharingRules';

/**
 * MUT-561 slice B (B3, B4; Basel 13244: the side drawer): make a share link. The form pane picks whole months (OW3, each
 * chip with its month names), how long it works and a PIN; the done pane swaps in (DESIGN.md › panes inside a drawer)
 * with the link shown once, Copy link, Copy message (OW4: never the PIN) and the warning to send the PIN separately.
 * The URL and the PIN live in this component's state only (D3): closing, Escape or a reload drops them. Review 1: the
 * create is called directly, not through a React Query mutation, so neither the PIN (its variables) nor the URL (its
 * data) is ever kept in the mutation cache.
 */

const FORM_ID = 'hosted-new-share-link-form';
/** The server's SHARE_LINK_MAX_VIEWERS (MUT-560): devices that may open one link. */
const MAX_VIEWERS = 3;
const PERIOD_KEY: Record<ShareLinkPeriod, string> = {
  LAST_1_MONTH: 'hosted.sharing.newLink.last1',
  LAST_2_MONTHS: 'hosted.sharing.newLink.last2',
  LAST_3_MONTHS: 'hosted.sharing.newLink.last3',
  WHOLE_PROFILE: 'hosted.sharing.newLink.whole',
};
const DAYS_KEY: Record<ShareDays, string> = { 1: 'hosted.sharing.newLink.days1', 7: 'hosted.sharing.newLink.days7', 30: 'hosted.sharing.newLink.days30' };

export function NewShareLinkDrawer({ profile, listLimit, onClose }: { profile: HostedProfile; listLimit?: number; onClose: () => void }) {
  const { t } = useLanguage();
  const writable = useWritableFor(profile);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<ShareLinkCreated | null>(null);

  return (
    <Drawer
      title={t('hosted.sharing.newLink.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      readOnly={!writable && !created}
      footer={
        created ? (
          <div className="drawer-footer-right">
            <Button type="button" onClick={onClose}>
              {t('hosted.sharing.done.done')}
            </Button>
          </div>
        ) : (
          <div className="drawer-footer-right">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form={FORM_ID} isLoading={pending} keepLabelWhileLoading aria-busy={pending || undefined}>
              {t('hosted.sharing.newLink.create')}
            </Button>
          </div>
        )
      }
    >
      {created ? <DonePane profile={profile} created={created} /> : <LinkForm profile={profile} pending={pending} setPending={setPending} listLimit={listLimit} readOnly={!writable} onCreated={setCreated} />}
    </Drawer>
  );
}

interface LinkFormProps {
  profile: HostedProfile;
  pending: boolean;
  setPending: (pending: boolean) => void;
  listLimit?: number;
  readOnly: boolean;
  onCreated: (link: ShareLinkCreated) => void;
}

function LinkForm({ profile, pending, setPending, listLimit, readOnly, onCreated }: LinkFormProps) {
  const { t, language } = useLanguage();
  const ids = useId();
  const queryClient = useQueryClient();
  const pinRef = useRef<HTMLInputElement>(null);
  // Review 4: read on every render, so a drawer left open past midnight names the new month's periods
  const today = dayIn(new Date(), profile.timezone);
  const [period, setPeriod] = useState<ShareLinkPeriod>('LAST_3_MONTHS');
  const [days, setDays] = useState<ShareDays>(7);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Line | null>(null);

  const periodLabel = (value: ShareLinkPeriod) => {
    const months = monthsLabel(periodRange(value, today).from, periodRange(value, today).to, language);
    return months ? `${t(PERIOD_KEY[value])} · ${months}` : t(PERIOD_KEY[value]);
  };
  const chosen = rangeLine(periodRange(period, today), language);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || readOnly) return;
    setBanner(null);
    const folded = pinOf(pin);
    if (!folded) {
      setPinError('hosted.sharing.newLink.errors.pin');
      pinRef.current?.focus();
      return;
    }
    setPinError(null);
    setPending(true);
    try {
      const link = await api.createShareLink(profile.id, { period, expiresInDays: days, pin: folded });
      void queryClient.invalidateQueries({ queryKey: shareLinksKey(profile.id) });
      void trackPortal('share_link_created', { period: periodEvent(period), expires_in_days: days });
      setPin('');
      onCreated(link);
    } catch (error) {
      const mapped = linkErrorOf(error, listLimit);
      if (mapped.refetch) refetchAfterRefusal(queryClient, shareLinksKey(profile.id));
      setPinError(mapped.field ?? null);
      setBanner(mapped.banner ?? null);
      if (mapped.field) pinRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {banner && (
        <div className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>{t(banner.key, banner.vars)}</span>
        </div>
      )}
      <ReadOnlyFields readOnly={readOnly}>
        <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)}>
          <fieldset className="form-group hp-sharing-choices">
            <legend className="form-label">{t('hosted.sharing.newLink.period')}</legend>
            {SHARE_PERIODS.map((value) => (
              <label key={value} className="hp-sharing-choice">
                <input type="radio" name={`${ids}-period`} value={value} checked={period === value} onChange={() => setPeriod(value)} />
                <span>{periodLabel(value)}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="form-group hp-sharing-choices hp-sharing-choices--row">
            <legend className="form-label">{t('hosted.sharing.newLink.worksFor')}</legend>
            {SHARE_DAYS.map((value) => (
              <label key={value} className="hp-sharing-choice">
                <input type="radio" name={`${ids}-days`} value={value} checked={days === value} onChange={() => setDays(value)} />
                <span>{t(DAYS_KEY[value])}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-pin`}>
              {t('hosted.sharing.newLink.pin')}
            </label>
            <div className="hp-password">
              <input
                ref={pinRef}
                id={`${ids}-pin`}
                className={`input${pinError ? ' input-error' : ''}${showPin ? '' : ' hp-pin-masked'}`}
                // Review 2: never type=password, so no password manager offers to save it; masked by style instead
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={8}
                readOnly={pending}
                value={pin}
                aria-invalid={Boolean(pinError)}
                aria-describedby={pinError ? `${ids}-pin-error` : `${ids}-pin-hint`}
                onChange={(event) => setPin(event.target.value)}
              />
              <button type="button" className="hp-password-toggle press" aria-pressed={showPin} aria-controls={`${ids}-pin`} onClick={() => setShowPin((shown) => !shown)}>
                {t(showPin ? 'hosted.auth.hide' : 'hosted.auth.show')}
              </button>
            </div>
            {pinError ? (
              <p className="form-error" id={`${ids}-pin-error`}>
                {t(pinError)}
              </p>
            ) : (
              <p className="form-hint" id={`${ids}-pin-hint`}>
                {t('hosted.sharing.newLink.pinHint')}
              </p>
            )}
          </div>
          <p className="hp-sharing-intro">{t('hosted.sharing.newLink.summary', { period: t(chosen.key, chosen.vars), viewers: String(MAX_VIEWERS) })}</p>
        </form>
      </ReadOnlyFields>
    </>
  );
}

/** B4: the link, once. Copy message is OW4's ready text in the portal's language (Basel 13244), never the PIN. */
function DonePane({ profile, created }: { profile: HostedProfile; created: ShareLinkCreated }) {
  const { t, language } = useLanguage();
  const ids = useId();
  const [copied, setCopied] = useState<'link' | 'message' | 'failed' | null>(null);
  const range = rangeLine(created, language);
  const until = shortDay(created.expiresAt, language, profile.timezone);
  const months = monthsLabel(created.from, created.to, language);

  const message = t('hosted.sharing.message.text', {
    profile: profile.name,
    period: months ?? t('hosted.sharing.message.wholeProfile'),
    url: created.url,
    until,
  });

  const copy = async (what: 'link' | 'message') => setCopied((await copyToClipboard(what === 'link' ? created.url : message)) ? what : 'failed');

  return (
    <section className="hp-sharing-done" aria-labelledby={`${ids}-title`}>
      <Scene name="link-ready" size={120} />
      <h3 id={`${ids}-title`}>{t('hosted.sharing.done.title')}</h3>
      <p className="hp-sharing-intro">{t('hosted.sharing.done.summary', { period: t(range.key, range.vars), until, viewers: String(MAX_VIEWERS) })}</p>
      <div className="form-group">
        <label className="form-label" htmlFor={`${ids}-url`}>
          {t('hosted.sharing.done.link')}
        </label>
        <input id={`${ids}-url`} className="input" dir="ltr" readOnly value={created.url} onFocus={(event) => event.currentTarget.select()} />
      </div>
      <div className="hp-empty-actions hp-sharing-copy">
        <Button type="button" variant="secondary" onClick={() => void copy('link')}>
          {t('hosted.sharing.done.copyLink')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void copy('message')}>
          {t('hosted.sharing.done.copyMessage')}
        </Button>
      </div>
      <p className="form-hint" role="status" aria-live="polite">
        {copied === 'link' ? t('hosted.sharing.done.copiedLink') : copied === 'message' ? t('hosted.sharing.done.copiedMessage') : copied === 'failed' ? t('hosted.sharing.done.copyFailed') : ''}
      </p>
      <p className="hp-banner hp-banner-warning" role="note">
        <AlertIcon />
        <span>{t('hosted.sharing.done.pinWarning')}</span>
      </p>
    </section>
  );
}
