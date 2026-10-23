import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { Language } from '../../lib/i18n/types';
import { ApiError, apiErrorReason, type BillingOverview } from '../api/client';
import { billingQuery, billingReturnPath, CONFIRM_POLL_LIMIT_MS, CONFIRM_POLL_MS, useOpenBillingPortal, useStartCheckout } from '../data/billingQueries';
import {
  billingViewOf,
  checkoutRouteOf,
  currencyOfCountry,
  profilesListOf,
  yearlySavingOf,
  type BillingPanel,
  type BillingProfile,
  type BillingView,
} from '../data/billingView';
import { countryName, countryOptions } from '../data/countries';
import { formatDecimal } from '../format/DecimalAmount';
import { minorToDecimal } from '../format/currencies';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { ME_KEY, useMe } from '../session/me';
import { SUPPORT_EMAIL } from '../terms';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { RadioCards } from './RadioCards';

/**
 * Settings › Billing (MUT-362, plan §2.7–§2.8): the account menu's drawer, Arabic first. The status view reads in one
 * order (DR1): a chip, where you stand, the one action, then the price and the rules. Subscribe is a second step in
 * the same drawer (DR2, `?step=subscribe`); Stripe's English pages come only after our own explanation (AC4, DR6).
 * Coming back from Checkout, it polls until the webhook lands (eng review D4).
 */

export interface BillingDrawerProps {
  step: 'subscribe' | undefined;
  checkout: 'success' | 'cancelled' | undefined;
  /** Back from the Customer Portal (`?portal=returned`). */
  portalReturned?: boolean;
  onStep: (step: 'subscribe' | undefined) => void;
  onClose: () => void;
}

type Tone = 'mint' | 'butter' | 'rose' | 'lavender';
type Phase = 'confirming' | 'done' | 'slow' | null;
type Failure = 'needsHelp' | 'alreadySubscribed' | 'sessionFailed' | null;

const LIVE = new Set(['active', 'trialing', 'past_due']);

/** One drawer frame for every state: switching loading → content, or status → Subscribe, swaps its body, never the frame. */
export function BillingDrawer({ step, checkout, portalReturned = false, onStep, onClose }: BillingDrawerProps) {
  const t = useT();
  const billing = useQuery(billingQuery);
  const phase = useCheckoutReturn(checkout, billing.data);
  usePortalReturn(portalReturned, billing.data);
  const subscribe = useSubscribeForm(billing.data);
  const subscribing = step === 'subscribe' && billing.data !== undefined;
  const title = step === 'subscribe' ? t('hosted.billing.subscribe.title') : t('hosted.billing.title');

  let body;
  if (billing.isPending) {
    body = (
      <div className="hp-billing" aria-busy="true">
        <div className="hp-billing-skeleton" style={{ inlineSize: '30%' }} />
        <div className="hp-billing-skeleton hp-billing-skeleton-headline" />
        <div className="hp-billing-skeleton" style={{ inlineSize: '65%' }} />
        <div className="hp-billing-skeleton hp-billing-skeleton-button" />
      </div>
    );
  } else if (billing.isError) {
    body = (
      <div className="hp-billing">
        <Banner tone="error" text={t('hosted.billing.states.loadFailed')} />
        <div>
          <Button variant="secondary" onClick={() => void billing.refetch()}>
            {t('hosted.billing.states.retry')}
          </Button>
        </div>
      </div>
    );
  } else if (subscribing) {
    body = <SubscribeBody billing={billing.data} title={title} form={subscribe} onBack={() => onStep(undefined)} />;
  } else {
    body = <StatusView billing={billing.data} phase={phase} cancelled={checkout === 'cancelled'} onSubscribe={() => onStep('subscribe')} />;
  }

  return (
    <Drawer title={title} onClose={onClose} closeLabel={t('common.close')} footer={subscribing ? <SubscribeFooter form={subscribe} /> : undefined}>
      {body}
    </Drawer>
  );
}

/** Eng review D4: after Checkout, refetch every 2 s for up to 30 s until the webhook has mirrored the subscription. */
function useCheckoutReturn(checkout: BillingDrawerProps['checkout'], billing: BillingOverview | undefined): Phase {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>(checkout === 'success' ? 'confirming' : null);
  // Render-time adjustment, not an effect (react-hooks v7): the poll ends as soon as the subscription is there.
  if (phase === 'confirming' && billing?.subscription && LIVE.has(billing.subscription.status)) setPhase('done');
  useEffect(() => {
    if (phase !== 'confirming') return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= CONFIRM_POLL_LIMIT_MS) {
        setPhase('slow');
        return;
      }
      void queryClient.invalidateQueries({ queryKey: billingQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    }, CONFIRM_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, queryClient]);
  return phase;
}

/**
 * Back from the Customer Portal the webhook can land after the first read (seen in release-QA: ~0.7 s late), so
 * refetch quietly every 2 s for up to 30 s, stopping at the first change from what the drawer showed on return.
 */
function usePortalReturn(returned: boolean, billing: BillingOverview | undefined): void {
  const queryClient = useQueryClient();
  const [polling, setPolling] = useState(returned);
  const [shownOnReturn, setShownOnReturn] = useState<string | null>(null);
  const shown = billing ? JSON.stringify(billing.subscription) : null;
  // Render-time adjustment, not an effect (react-hooks v7).
  if (polling && shown !== null) {
    if (shownOnReturn === null) setShownOnReturn(shown);
    else if (shown !== shownOnReturn) setPolling(false);
  }
  useEffect(() => {
    if (!polling) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= CONFIRM_POLL_LIMIT_MS) {
        setPolling(false);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: billingQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    }, CONFIRM_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, queryClient]);
}

function StatusView({ billing, phase, cancelled, onSubscribe }: { billing: BillingOverview; phase: Phase; cancelled: boolean; onSubscribe: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const me = useMe();
  const { pathname } = useLocation();
  const headline = useRef<HTMLHeadingElement>(null);
  const portal = useOpenBillingPortal();
  const profiles: BillingProfile[] = me.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    owned: p.owned,
    billing: p.billing,
  }));
  const view = billingViewOf(billing, profiles, new Date());
  const list = profilesListOf(profiles);
  const failure = failureOf(portal.error);

  // DR10: switching back from the Subscribe step, or returning from Stripe, puts focus on where the person stands.
  useEffect(() => headline.current?.focus(), []);

  return (
    <div className="hp-billing">
      {phase === 'done' && <Banner tone="ok" text={t('hosted.billing.states.subscribed')} />}
      {phase === 'slow' && <Banner tone="info" text={t('hosted.billing.states.slow')} />}
      {cancelled && phase === null && <Banner tone="info" text={t('hosted.billing.states.cancelled')} />}
      {failure && <FailureBanner failure={failure} />}

      {phase === 'confirming' ? (
        <div className="hp-billing-status" aria-live="polite">
          <Chip tone="butter" label={t('hosted.billing.chip.confirming')} />
          <h3 ref={headline} tabIndex={-1} className="hp-billing-headline">
            {t('hosted.billing.states.confirming')}
          </h3>
          <p>{t('hosted.billing.states.confirmingNote')}</p>
        </div>
      ) : (
        <PanelStatus panel={view.panel} language={language} headlineRef={headline} />
      )}

      {phase !== 'confirming' && (
        <Action view={view} busy={portal.isPending} onSubscribe={onSubscribe} onPortal={() => portal.mutate(billingReturnPath(pathname))} />
      )}

      {view.action === 'subscribe' && !view.openSoon && phase === null && <PlanLines catalog={billing.catalog} language={language} />}
      {list.length > 0 && <ProfilesList profiles={list} />}
    </div>
  );
}

function PanelStatus({ panel, language, headlineRef }: { panel: BillingPanel; language: Language; headlineRef: React.RefObject<HTMLHeadingElement | null> }) {
  const t = useT();
  const tp = useTp();
  const day = (iso: string | null) => (iso ? formatInstant(iso, language, browserTimezone()) : '');
  const { chip, tone, headline, context } = panelCopy(panel, t, tp, day);
  return (
    <div className="hp-billing-status">
      <Chip tone={tone} label={chip} />
      <h3 ref={headlineRef} tabIndex={-1} className="hp-billing-headline">
        {headline}
      </h3>
      {context && <p>{context}</p>}
    </div>
  );
}

type Translate = ReturnType<typeof useT>;
type PluralTranslate = ReturnType<typeof useTp>;

/** DR1 + DR8: each panel's chip (colour by meaning), where the person stands, and one line of context. */
function panelCopy(
  panel: BillingPanel,
  t: Translate,
  tp: PluralTranslate,
  day: (iso: string | null) => string,
): { chip: string; tone: Tone; headline: string; context: string | null } {
  const k = (key: string, vars?: Record<string, string>) => t(`hosted.billing.${key}`, vars);
  switch (panel.kind) {
    case 'trial':
      return {
        chip: k('chip.trial'),
        tone: 'butter',
        headline: tp('hosted.billing.headline.trialDaysLeft', panel.daysLeft),
        context: k('context.trial'),
      };
    case 'trialEnded':
      return {
        chip: k('chip.readOnly'),
        tone: 'rose',
        headline: k('headline.trialEnded'),
        context: panel.lockAt ? k('context.trialEnded', { date: day(panel.lockAt) }) : k('context.trialEndedNoDate'),
      };
    case 'locked':
      return {
        chip: k('chip.locked'),
        tone: 'rose',
        headline: k('headline.locked'),
        context: k('context.locked'),
      };
    case 'active':
      return {
        chip: k('chip.active'),
        tone: 'mint',
        headline: k('headline.active', { date: day(panel.renewsAt) }),
        context: k('manageNote'),
      };
    case 'ending':
      return {
        chip: k('chip.ending'),
        tone: 'butter',
        headline: k('headline.ending', { date: day(panel.endsAt) }),
        context: k('context.ending'),
      };
    case 'grace':
      return {
        chip: k('chip.grace'),
        tone: 'butter',
        headline: k('headline.grace'),
        context: k('context.grace'),
      };
    case 'unpaid':
      return {
        chip: k('chip.paymentFailed'),
        tone: 'rose',
        headline: k('headline.unpaid'),
        context: k('context.unpaid'),
      };
    case 'needsHelp':
      return {
        chip: k('chip.help'),
        tone: 'rose',
        headline: k('headline.needsHelp'),
        context: k('context.needsHelp'),
      };
    case 'lapsed':
      return {
        chip: k('chip.readOnly'),
        tone: 'rose',
        headline: k('headline.lapsed'),
        context: k('context.lapsed'),
      };
    case 'coveredByGrant':
      return panel.until
        ? {
            chip: k('chip.covered'),
            tone: 'lavender',
            headline: k('headline.coveredUntil', { date: day(panel.until) }),
            context: k('context.coveredUntil'),
          }
        : {
            chip: k('chip.covered'),
            tone: 'lavender',
            headline: k('headline.coveredByGrant'),
            context: k('context.coveredByGrant'),
          };
    case 'coveredByMalafat':
      return {
        chip: k('chip.covered'),
        tone: 'lavender',
        headline: k('headline.coveredByMalafat'),
        context: k('context.coveredByMalafat'),
      };
    case 'ownedByOthers':
      return {
        chip: k('chip.covered'),
        tone: 'lavender',
        headline: k('headline.ownedByOthers'),
        context: k('context.ownedByOthers'),
      };
    case 'none':
      return {
        chip: k('chip.readOnly'),
        tone: 'rose',
        headline: k('headline.none'),
        context: k('context.none'),
      };
  }
}

function Action({ view, busy, onSubscribe, onPortal }: { view: BillingView; busy: boolean; onSubscribe: () => void; onPortal: () => void }) {
  const t = useT();
  switch (view.action) {
    case 'subscribe':
      return view.openSoon ? (
        <Banner tone="info" text={t('hosted.billing.openSoon')} />
      ) : (
        <div>
          <Button onClick={onSubscribe}>{t('hosted.billing.action.subscribe')}</Button>
        </div>
      );
    case 'manage':
    case 'payInPortal':
      return (
        <div className="hp-billing-action">
          <Button variant={view.action === 'manage' ? 'secondary' : 'primary'} onClick={onPortal} isLoading={busy} aria-busy={busy}>
            {t(`hosted.billing.action.${view.action}`)}
          </Button>
          {view.action === 'manage' && view.panel.kind !== 'active' && <p className="hp-billing-fine">{t('hosted.billing.manageNote')}</p>}
        </div>
      );
    case 'contactUs':
      return <ContactUs />;
    default:
      return null;
  }
}

/** DR12: both currencies until the person picks a country; yearly prices in the fine print. */
function PlanLines({ catalog, language }: { catalog: BillingOverview['catalog']; language: Language }) {
  const t = useT();
  const pairs = (['ILS', 'USD'] as const).flatMap((currency) => (catalog[currency] ? [{ currency, ...catalog[currency]! }] : []));
  return (
    <div className="hp-billing-plan">
      <div className="hp-billing-plan-line">
        <span>{t('hosted.billing.plan.name')}</span>
        <span>
          {pairs.map((p, i) => (
            <span key={p.currency}>
              {i > 0 && ` ${t('hosted.billing.plan.or')} `}
              <Amount minor={p.month} currency={p.currency} language={language} />
            </span>
          ))}{' '}
          {t('hosted.billing.plan.aMonth')}
        </span>
      </div>
      <p className="hp-billing-fine">
        {t('hosted.billing.plan.aYear')}:{' '}
        {pairs.map((p, i) => (
          <span key={p.currency}>
            {i > 0 && ' / '}
            <Amount minor={p.year} currency={p.currency} language={language} />
          </span>
        ))}
      </p>
      <p className="hp-billing-fine">{t('hosted.billing.plan.vat')}</p>
      <p className="hp-billing-fine">{t('hosted.billing.plan.cancelRule')}</p>
    </div>
  );
}

function ProfilesList({ profiles }: { profiles: BillingProfile[] }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const day = (iso: string | null) => (iso ? formatInstant(iso, language, browserTimezone()) : '');
  return (
    <div className="hp-billing-profiles">
      <h4>{t('hosted.billing.profilesTitle')}</h4>
      <ul>
        {profiles.map((p) => (
          <li key={p.id}>
            <span className="hp-billing-profile-name">{p.name}</span>
            <span>{panelCopy(entitlementPanel(p), t, tp, day).chip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One profile's own entitlement as a panel, for its label in the DR3 list. */
function entitlementPanel(profile: BillingProfile): BillingPanel {
  const e = profile.billing!;
  if (e.source === 'MALAFAT') return { kind: 'coveredByMalafat' };
  if (e.source === 'OPERATOR') return { kind: 'coveredByGrant', until: e.until };
  if (e.source === 'TRIAL')
    return e.state === 'ACTIVE'
      ? { kind: 'trial', endsAt: e.until ?? '', daysLeft: 0 }
      : e.state === 'LOCKED'
        ? { kind: 'locked' }
        : { kind: 'trialEnded', lockAt: e.until };
  if (e.source === 'STRIPE') return e.state === 'READ_ONLY' ? { kind: 'lapsed' } : { kind: 'active', renewsAt: e.until ?? '', interval: null };
  return { kind: 'none' };
}

/** The Subscribe step's choices and its Continue, kept in BillingDrawer so the button can live in the pinned footer (DR10). */
function useSubscribeForm(billing: BillingOverview | undefined) {
  const { pathname } = useLocation();
  const [country, setCountry] = useState('');
  const [buyer, setBuyer] = useState<'person' | 'business'>('person');
  const [interval, setBillingInterval] = useState<'month' | 'year'>('month');
  const checkout = useStartCheckout();
  const route = billing ? checkoutRouteOf(country || null, buyer, billing.countries) : null;
  const currency = country ? currencyOfCountry(country) : null;
  const pair = billing && currency ? billing.catalog[currency] : null;
  const canContinue = route !== null && route !== 'contact-us' && pair !== null && !checkout.isPending;
  const submit = () => {
    if (!canContinue) return;
    checkout.mutate({
      interval,
      country,
      buyer,
      returnPath: billingReturnPath(pathname),
    });
  };
  return {
    country,
    setCountry,
    buyer,
    setBuyer,
    interval,
    setBillingInterval,
    checkout,
    route,
    currency,
    pair,
    canContinue,
    submit,
  };
}

type SubscribeForm = ReturnType<typeof useSubscribeForm>;

function SubscribeFooter({ form }: { form: SubscribeForm }) {
  const t = useT();
  return (
    <Button
      className="hp-billing-continue"
      onClick={form.submit}
      disabled={!form.canContinue}
      isLoading={form.checkout.isPending}
      aria-busy={form.checkout.isPending}
    >
      {t('hosted.billing.subscribe.continue')}
    </Button>
  );
}

function SubscribeBody({ billing, title, form, onBack }: { billing: BillingOverview; title: string; form: SubscribeForm; onBack: () => void }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { country, buyer, interval, route, currency, pair } = form;
  const failure = failureOf(form.checkout.error);
  const saving = pair ? yearlySavingOf(pair) : null;
  const yearlyNote =
    !saving || !currency
      ? null
      : saving.kind === 'monthsFree'
        ? tp('hosted.billing.subscribe.monthsFree', saving.months)
        : t('hosted.billing.subscribe.save', {
            amount: formatMinor(saving.amount, currency, language),
          });

  // DR10: entering the step puts focus on its heading.
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="hp-billing">
      <button type="button" className="hp-billing-back" onClick={onBack}>
        {t('hosted.billing.subscribe.back')}
      </button>
      <h3 ref={heading} tabIndex={-1} className="sr-only">
        {title}
      </h3>

      <Select
        label={t('hosted.billing.subscribe.country')}
        id={`${ids}-country`}
        hint={t('hosted.billing.subscribe.countryHint')}
        value={country}
        onChange={(e) => form.setCountry(e.target.value)}
      >
        <option value="">{t('hosted.billing.subscribe.countryChoose')}</option>
        {countryOptions(language).map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </Select>

      <div className="hp-billing-field">
        <span id={`${ids}-buyer`} className="input-label">
          {t('hosted.billing.subscribe.buyer')}
        </span>
        <RadioCards
          name={`${ids}-buyer`}
          labelledBy={`${ids}-buyer`}
          value={buyer}
          onChange={form.setBuyer}
          options={[
            {
              value: 'person',
              label: t('hosted.billing.subscribe.person'),
              note: t('hosted.billing.subscribe.personNote'),
            },
            {
              value: 'business',
              label: t('hosted.billing.subscribe.business'),
              note: t('hosted.billing.subscribe.businessNote'),
            },
          ]}
        />
      </div>

      <div className="hp-billing-field">
        <span id={`${ids}-interval`} className="input-label">
          {t('hosted.billing.subscribe.interval')}
        </span>
        <SegmentedControl
          className="hp-billing-interval"
          labelledBy={`${ids}-interval`}
          value={interval}
          onChange={form.setBillingInterval}
          options={[
            { value: 'month', label: t('hosted.billing.subscribe.monthly') },
            {
              value: 'year',
              label: yearlyNote ? `${t('hosted.billing.subscribe.yearly')} · ${yearlyNote}` : t('hosted.billing.subscribe.yearly'),
            },
          ]}
        />
      </div>

      {route === 'contact-us' ? (
        <div className="hp-billing-stack">
          <Banner
            tone="info"
            text={t('hosted.billing.subscribe.contactUs', {
              country: countryName(country, language),
            })}
          />
          <ContactUs />
        </div>
      ) : (
        pair &&
        currency && (
          <div className="hp-billing-summary">
            <span>{t('hosted.billing.subscribe.summary')}</span>
            <span>
              <Amount minor={pair[interval]} currency={currency} language={language} />{' '}
              {t(interval === 'month' ? 'hosted.billing.subscribe.perMonth' : 'hosted.billing.subscribe.perYear')}
            </span>
          </div>
        )
      )}
      {failure && <FailureBanner failure={failure} />}
      <p className="hp-billing-fine">{t('hosted.billing.subscribe.headsUp')}</p>
      {billing.catalog.ILS === null && billing.catalog.USD === null && <Banner tone="info" text={t('hosted.billing.openSoon')} />}
    </div>
  );
}

function failureOf(error: Error | null): Failure {
  if (!error) return null;
  const reason = error instanceof ApiError ? apiErrorReason(error) : undefined;
  if (reason === 'BILLING_ACCOUNT_NEEDS_HELP' || reason === 'CONTACT_US') return 'needsHelp';
  if (reason === 'ALREADY_SUBSCRIBED') return 'alreadySubscribed';
  return 'sessionFailed';
}

function FailureBanner({ failure }: { failure: Exclude<Failure, null> }) {
  const t = useT();
  return (
    <div className="hp-billing-stack">
      <Banner tone="error" text={t(`hosted.billing.states.${failure}`)} />
      {failure === 'needsHelp' && <ContactUs />}
    </div>
  );
}

function ContactUs() {
  const t = useT();
  return (
    <div>
      <a className="btn btn-secondary btn-md" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('hosted.billing.mailSubject'))}`}>
        {t('hosted.billing.action.contactUs')}
      </a>
    </div>
  );
}

function Banner({ tone, text }: { tone: 'ok' | 'info' | 'error'; text: string }) {
  return (
    <div className={`hp-banner hp-banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <AlertIcon />
      <span>{text}</span>
    </div>
  );
}

function Chip({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`hp-billing-chip hp-billing-chip-${tone}`}>{label}</span>;
}

function formatMinor(minor: number, currency: 'ILS' | 'USD', language: Language): string {
  return formatDecimal(minorToDecimal(minor, currency), currency, language);
}

/** Amounts are plain `<bdi>` in the figure face (MUT-109), so ₪39 reads correctly inside Arabic. */
function Amount({ minor, currency, language }: { minor: number; currency: 'ILS' | 'USD'; language: Language }) {
  return <bdi className="hp-amount">{formatMinor(minor, currency, language)}</bdi>;
}
