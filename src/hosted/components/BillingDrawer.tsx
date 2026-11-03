import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { Language } from '../../lib/i18n/types';
import { trackPortal } from '../analytics/portalAnalytics';
import { ApiError, apiErrorReason, type BillingOverview, type BillingYearlySwitch, type PauseEndResult, type YearlySwitchResult } from '../api/client';
import {
  assertStripeUrl,
  billingQuery,
  billingReturnPath,
  CONFIRM_POLL_LIMIT_MS,
  CONFIRM_POLL_MS,
  stripeNavigation,
  useEndPause,
  useKeepPlan,
  useOpenBillingPortal,
  useRetryCardPayment,
  useStartCheckout,
} from '../data/billingQueries';
import {
  billingViewOf,
  canCancelOf,
  canKeepOf,
  checkoutRouteOf,
  currencyOfCountry,
  daysLeft,
  comebackOfferOf,
  eligibleOfferOf,
  firstChargeOf,
  isConfirmed,
  isSellable,
  monthPriceOf,
  offerAnalyticsName,
  offerDay,
  offerFor,
  profilesListOf,
  renewalPriceOf,
  yearlySavingOf,
  yearlySwitchLineOf,
  type BillingPanel,
  type BillingProfile,
  type BillingView,
} from '../data/billingView';
import { countryName, countryOptions } from '../data/countries';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { trialWelcomeApplies } from '../data/trialPrompt';
import { useAnswerTrialPrompt } from '../data/trialPromptQueries';
import { ME_KEY, useMe } from '../session/me';
import { takeTrialWelcomeOffer } from '../session/trialWelcomeOffer';
import { SUPPORT_EMAIL } from '../terms';
import { Amount, Banner } from './billingParts';
import { formatMinor, sentence } from './billingText';
import { SwitchBody, SwitchFooter } from './BillingSwitchBody';
import { useSwitchStep } from './useSwitchStep';
import { CancelBody, CancelFooter } from './BillingCancelFlow';
import { useCancelFlow, type CancelOutcome } from './useCancelFlow';
import { Drawer } from './Drawer';
import { InPlaceConfirm, useConfirmStep } from './InPlaceConfirm';
import { OfferTopLine } from './OfferTopLine';
import { RadioCards } from './RadioCards';

/**
 * Settings › Billing (MUT-362, plan §2.7–§2.8): the account menu's drawer, Arabic first. The status view reads in one
 * order (DR1): a chip, where you stand, the one action, then the price and the rules. Subscribe is a second step in
 * the same drawer (DR2, `?step=subscribe`); Stripe's English pages come only after our own explanation (AC4, DR6).
 * Coming back from Checkout or the Customer Portal, it polls until the webhook lands (eng review D4).
 * MUT-418: `?step=welcome` is the first-run "Your 14-day free trial has started" step, with adding a card recommended
 * and skippable; adding one goes to Subscribe, which carries the rest of the trial into Stripe (ADR-170 R-D2).
 */

export type BillingStep = 'subscribe' | 'welcome' | 'switch' | 'cancel';

/** ADR-160 D3: the free trial's length, for the welcome's "has started" wording (the server's TRIAL_DAYS). */
const TRIAL_LENGTH_DAYS = 14;

export interface BillingDrawerProps {
  step: BillingStep | undefined;
  checkout: 'success' | 'cancelled' | undefined;
  /** Back from the Customer Portal (`?portal=returned`). */
  portalReturned?: boolean;
  /** MUT-533 (D5): back from its card form (`?portal=card`): pay the past-due invoice on the new card, once. */
  cardUpdated?: boolean;
  /** `replace`: the new step takes this one's history entry (the welcome never comes back on Back). */
  onStep: (step: 'subscribe' | 'switch' | 'cancel' | undefined, replace?: boolean) => void;
  onClose: () => void;
}

type Tone = 'mint' | 'butter' | 'rose' | 'lavender';
type Phase = 'confirming' | 'done' | 'slow' | null;
type Failure = 'needsHelp' | 'alreadySubscribed' | 'tooMany' | 'changed' | 'sessionFailed' | null;
/** MUT-532: the change the status view waits for the webhook to mirror after a press. */
type Awaiting = 'pause' | 'noPause' | 'cancel' | 'noCancel';

/** One drawer frame for every state: switching loading → content, or status → Subscribe, swaps its body, never the frame. */
export function BillingDrawer({ step, checkout, portalReturned = false, cardUpdated = false, onStep, onClose }: BillingDrawerProps) {
  const t = useT();
  const billing = useQuery(billingQuery);
  const phase = useCheckoutReturn(checkout, billing.data);
  usePortalReturn(portalReturned, billing.data);
  useCardRetryOnReturn(cardUpdated);
  const subscribe = useSubscribeForm(billing.data);
  const subscribing = step === 'subscribe' && billing.data !== undefined;
  const welcome = useTrialWelcome(step === 'welcome', billing.data, onStep, onClose);
  const welcomeTitle = step === 'welcome' && (billing.isPending || welcome.open);
  // MUT-531: the switch to yearly is its own step; once it went through, the status view says so and waits for the
  // webhook to mirror the yearly plan.
  const [switched, setSwitched] = useState<YearlySwitchResult | null>(null);
  const switching = step === 'switch' && billing.data !== undefined;
  const switchStep = useSwitchStep(
    step === 'switch',
    useCallback((result: YearlySwitchResult) => {
      setSwitched(result);
      onStep(undefined);
    }, [onStep]),
  );
  usePollBilling(switched !== null && billing.data?.subscription?.interval !== 'year', useCallback(() => setSwitched((s) => s), []));
  // MUT-532: the cancel flow is its own step too; what it ended in is said on the status view, which waits for the
  // webhook to mirror the change (a pause, a cancel), like the switch.
  const [outcome, setOutcome] = useState<CancelOutcome | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const cancelling = step === 'cancel' && billing.data !== undefined;
  const cancelFlow = useCancelFlow(
    step === 'cancel',
    useCallback(
      (done: CancelOutcome) => {
        setOutcome(done);
        setAwaiting(done.kind === 'paused' ? 'pause' : done.kind === 'cancelled' ? 'cancel' : null);
        onStep(undefined);
      },
      [onStep],
    ),
  );
  // Render-time adjustment, not an effect (react-hooks v7): the poll ends once the mirror shows the change.
  if (awaiting !== null && billing.data && mirrored(awaiting, billing.data)) setAwaiting(null);
  usePollBilling(awaiting !== null, useCallback(() => setAwaiting(null), []));
  // Review: the step is on screen (loading included), so the shell's one offer is spent: closing it while billing
  // loads never has the shell open it again on this page.
  useEffect(() => {
    if (step === 'welcome') takeTrialWelcomeOffer();
  }, [step]);
  const title =
    step === 'subscribe'
      ? t('hosted.billing.subscribe.title')
      : step === 'switch'
        ? t('hosted.billing.switch.title')
        : step === 'cancel'
          ? t('hosted.billing.cancel.action')
          : welcomeTitle
            ? t('hosted.billing.welcome.title')
            : t('hosted.billing.title');

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
  } else if (welcome.open) {
    body = <WelcomeBody welcome={welcome} />;
  } else if (switching) {
    body = <SwitchBody step={switchStep} />;
  } else if (cancelling) {
    body = <CancelBody flow={cancelFlow} onBack={() => onStep(undefined)} />;
  } else if (subscribing) {
    body = <SubscribeBody billing={billing.data} title={title} form={subscribe} onBack={() => onStep(undefined)} />;
  } else {
    body = (
      <StatusView
        billing={billing.data}
        phase={phase}
        cancelled={checkout === 'cancelled'}
        switched={switched}
        outcome={outcome}
        onSubscribe={() => onStep('subscribe')}
        onSwitch={() => onStep('switch')}
        onCancelPlan={() => {
          setOutcome(null);
          onStep('cancel');
        }}
        onAwait={setAwaiting}
      />
    );
  }

  return (
    <Drawer
      title={title}
      onClose={welcome.open ? welcome.skip : onClose}
      closeLabel={t('common.close')}
      footer={
        welcome.open ? (
          <WelcomeFooter welcome={welcome} />
        ) : subscribing ? (
          <SubscribeFooter form={subscribe} />
        ) : switching ? (
          <SwitchFooter step={switchStep} onBack={() => onStep(undefined)} />
        ) : cancelling ? (
          <CancelFooter flow={cancelFlow} />
        ) : undefined
      }
    >
      {body}
    </Drawer>
  );
}

/** MUT-532: the mirror shows what a press asked Stripe for. */
function mirrored(awaiting: Awaiting, billing: BillingOverview): boolean {
  const sub = billing.subscription;
  switch (awaiting) {
    case 'pause':
      return Boolean(sub?.pause);
    case 'noPause':
      return !sub?.pause;
    case 'cancel':
      return sub?.cancelAtPeriodEnd === true;
    case 'noCancel':
      return sub?.cancelAtPeriodEnd !== true;
  }
}

/**
 * Refetch billing and /v1/me every 2 s while `active`, for up to 30 s, then `giveUp` (a stable callback). A slow read
 * (a cold price cache waits on Stripe) finishes rather than being cancelled by the next tick (review).
 */
function usePollBilling(active: boolean, giveUp: () => void): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= CONFIRM_POLL_LIMIT_MS) {
        giveUp();
        return;
      }
      void queryClient.invalidateQueries({ queryKey: billingQuery.queryKey }, { cancelRefetch: false });
      void queryClient.invalidateQueries({ queryKey: ME_KEY }, { cancelRefetch: false });
    }, CONFIRM_POLL_MS);
    return () => clearInterval(timer);
  }, [active, giveUp, queryClient]);
}

/** Eng review D4: after Checkout, poll until the webhook has mirrored a paid subscription. */
function useCheckoutReturn(checkout: BillingDrawerProps['checkout'], billing: BillingOverview | undefined): Phase {
  const [phase, setPhase] = useState<Phase>(checkout === 'success' ? 'confirming' : null);
  // Render-time adjustment, not an effect (react-hooks v7): the poll ends as soon as the subscription is paid.
  if (phase === 'confirming' && billing && isConfirmed(billing.subscription)) setPhase('done');
  usePollBilling(phase === 'confirming', useCallback(() => setPhase('slow'), []));
  return phase;
}

/**
 * Back from the Customer Portal the webhook can land after the first read (seen in release-QA: ~0.7 s late), so poll
 * quietly, stopping at the first change from what the drawer showed on return.
 */
/** MUT-533 (D5): one payment attempt per return from the card form, never on a re-render. */
function useCardRetryOnReturn(cardUpdated: boolean): void {
  const { mutate } = useRetryCardPayment();
  const asked = useRef(false);
  useEffect(() => {
    if (!cardUpdated || asked.current) return;
    asked.current = true;
    mutate();
  }, [cardUpdated, mutate]);
}

function usePortalReturn(returned: boolean, billing: BillingOverview | undefined): void {
  const [polling, setPolling] = useState(returned);
  const [shownOnReturn, setShownOnReturn] = useState<string | null>(null);
  const shown = billing ? JSON.stringify(billing.subscription) : null;
  // Render-time adjustment, not an effect (react-hooks v7).
  if (polling && shown !== null) {
    if (shownOnReturn === null) setShownOnReturn(shown);
    else if (shown !== shownOnReturn) setPolling(false);
  }
  usePollBilling(polling, useCallback(() => setPolling(false), []));
}

function StatusView({
  billing,
  phase,
  cancelled,
  switched,
  outcome,
  onSubscribe,
  onSwitch,
  onCancelPlan,
  onAwait,
}: {
  billing: BillingOverview;
  phase: Phase;
  cancelled: boolean;
  switched: YearlySwitchResult | null;
  outcome: CancelOutcome | null;
  onSubscribe: () => void;
  onSwitch: () => void;
  onCancelPlan: () => void;
  onAwait: (awaiting: Awaiting) => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const me = useMe();
  const { pathname } = useLocation();
  const headline = useRef<HTMLHeadingElement>(null);
  const portal = useOpenBillingPortal();
  // Review D4: a payment covers the profiles the person created (the server's list), not every profile they co-own.
  const covered = new Set(billing.coveredProfileIds);
  const profiles: BillingProfile[] = me.profiles.map((p) => ({ id: p.id, name: p.name, owned: covered.has(p.id), billing: p.billing }));
  const coOwnsOthers = me.profiles.some((p) => p.owned && !covered.has(p.id));
  const view = billingViewOf(billing, profiles, new Date());
  const list = profilesListOf(profiles);
  const failure = failureOf(portal.error);
  // While a payment is being confirmed, or is slow to show, nothing invites a second one (review).
  const settled = phase !== 'confirming' && phase !== 'slow';
  const offer = eligibleOfferOf(billing);
  const switchLine = yearlySwitchLineOf(billing);
  // MUT-525 DD10b: the subscription says when the launch offer was applied to it.
  const subscribed = billing.subscription?.offer ? t('hosted.billing.done.offerApplied') : t('hosted.billing.states.subscribed');
  const announcement =
    phase === 'confirming'
      ? t('hosted.billing.states.confirming')
      : phase === 'done'
        ? subscribed
        : phase === 'slow'
          ? t('hosted.billing.states.slow')
          : cancelled
            ? t('hosted.billing.states.cancelled')
            : '';

  // DR10: switching back from the Subscribe step, returning from Stripe, or the payment confirming puts focus on
  // where the person stands; each phase renders a new headline, so it moves with the phase.
  useEffect(() => headline.current?.focus(), [phase]);

  return (
    <div className="hp-billing">
      {/* One live region, always mounted, so each phase is announced (a region inserted already filled often isn't). */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {phase === 'done' && <Banner tone="ok" text={subscribed} live={false} />}
      {phase === 'slow' && <Banner tone="info" text={t('hosted.billing.states.slow')} live={false} />}
      {cancelled && phase === null && <Banner tone="info" text={t('hosted.billing.states.cancelled')} live={false} />}
      {switched && <SwitchedBanner result={switched} language={language} />}
      {/* MUT-532 (§6): the stay offer says what the next months cost; a pause and a cancel show in the panel itself. */}
      {outcome?.kind === 'stayed' && (
        <Banner tone="ok" text={sentence(t, 'hosted.billing.stay.done', { price: <Amount minor={outcome.result.monthlyAmount} currency={outcome.result.currency} language={language} /> })} />
      )}

      {phase === 'confirming' ? (
        <div className="hp-billing-status">
          <Chip tone="butter" label={t('hosted.billing.chip.confirming')} />
          <h3 ref={headline} tabIndex={-1} className="hp-billing-headline">
            {t('hosted.billing.states.confirming')}
          </h3>
          <p>{t('hosted.billing.states.confirmingNote')}</p>
        </div>
      ) : (
        <PanelStatus panel={view.panel} renewal={renewalPriceOf(billing)} language={language} headlineRef={headline} />
      )}

      {/* MUT-525 DD10c: the offer line in the context, right above Subscribe. */}
      {settled && view.action === 'subscribe' && !view.openSoon && offer && <OfferTopLine offer={offer} place="drawer" />}
      {settled && (
        <Action view={view} busy={portal.isPending} failure={failure} onSubscribe={onSubscribe} onPortal={(flow) => portal.mutate({ returnPath: billingReturnPath(pathname), ...(flow ? { flow } : {}) })} />
      )}

      {/* MUT-531 (AC2): the switch line under Manage billing, from the 2nd paid invoice of a monthly list price. */}
      {settled && !switched && switchLine && <SwitchLine yearlySwitch={switchLine} language={language} onSwitch={onSwitch} />}
      {/* MUT-532: the plan's own changes, in MTB3A: undo a pause or resume, take a cancel back, or cancel. */}
      {settled && <PlanChanges billing={billing} panel={view.panel} onCancelPlan={onCancelPlan} onAwait={onAwait} />}
      {view.action === 'subscribe' && !view.openSoon && phase === null && <PlanLines catalog={billing.catalog} offer={offer} language={language} />}
      {list.length > 0 && <ProfilesList profiles={list} />}
      {coOwnsOthers && <p className="hp-billing-fine">{t('hosted.billing.coOwnedNote')}</p>}
    </div>
  );
}

function PanelStatus({
  panel,
  renewal,
  language,
  headlineRef,
}: {
  panel: BillingPanel;
  renewal: ReturnType<typeof renewalPriceOf>;
  language: Language;
  headlineRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const t = useT();
  const tp = useTp();
  const day = (iso: string | null) => (iso ? formatInstant(iso, language, browserTimezone()) : '');
  const copy = panelCopy(panel, t, tp, day);
  const { chip, tone, headline } = copy;
  // MUT-525 DD3: a list-price plan says what it renews at (founder prices and a plan that ends keep today's line).
  const context: ReactNode =
    panel.kind === 'active' && renewal
      ? sentence(t, 'hosted.billing.context.renewsAt', { list: <Amount minor={renewal.minor} currency={renewal.currency} language={language} />, date: day(panel.renewsAt) })
      : copy.context;
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
        // DR6: the Stripe note sits under Manage billing; the context is the plan's own line.
        context: panel.interval === 'month' ? k('context.activeMonth') : panel.interval === 'year' ? k('context.activeYear') : null,
      };
    case 'activeTrial':
      return {
        chip: k('chip.active'),
        tone: 'mint',
        headline: k('headline.activeTrial', { date: day(panel.firstChargeAt) }),
        context: k('context.activeTrial'),
      };
    case 'pending':
      return {
        chip: k('chip.pending'),
        tone: 'butter',
        headline: k('headline.pending'),
        context: k('context.pending'),
      };
    case 'ending':
      return {
        chip: k('chip.ending'),
        tone: 'butter',
        headline: k('headline.ending', { date: day(panel.endsAt) }),
        context: k('context.ending'),
      };
    case 'pauseScheduled':
      return {
        chip: k('chip.pausing'),
        tone: 'butter',
        headline: k('headline.pauseScheduled', { date: day(panel.from) }),
        context: panel.until ? k('context.pauseScheduled', { until: day(panel.until) }) : null,
      };
    case 'paused':
      return {
        chip: k('chip.paused'),
        tone: 'lavender',
        headline: k('headline.paused', { date: day(panel.until) }),
        context: k('context.paused', { date: day(panel.until) }),
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

/** MUT-531 (AC2, D3): "Switch to yearly and save ₪58 a year", the saving from the server (the catalog's, never written here). */
function SwitchLine({ yearlySwitch, language, onSwitch }: { yearlySwitch: BillingYearlySwitch; language: Language; onSwitch: () => void }) {
  const t = useT();
  return (
    <div className="hp-billing-switch">
      {yearlySwitch.savings !== null && (
        <p>{sentence(t, 'hosted.billing.switch.line', { amount: <Amount minor={yearlySwitch.savings} currency={yearlySwitch.currency} language={language} /> })}</p>
      )}
      <div>
        <Button variant="secondary" onClick={onSwitch}>
          {t('hosted.billing.switch.action')}
        </Button>
      </div>
    </div>
  );
}

/**
 * MUT-532 (D7, D8): Don't pause before a pause starts, Resume now while it runs (a confirm says what it charges
 * today), Keep my plan on a plan that ends, and Cancel plan, which opens the cancel flow.
 */
function PlanChanges({ billing, panel, onCancelPlan, onAwait }: { billing: BillingOverview; panel: BillingPanel; onCancelPlan: () => void; onAwait: (awaiting: Awaiting) => void }) {
  const t = useT();
  const { language } = useLanguage();
  const endPause = useEndPause();
  const keep = useKeepPlan();
  const { open, ask, cancel, close, triggerRef } = useConfirmStep();
  const failure = failureOf(endPause.error ?? keep.error);
  const approveUrl = approveUrlOf(endPause.data);
  const month = monthPriceOf(billing);
  const ended = (result: PauseEndResult) => {
    close();
    // A charge that went through, or failed and is retried, both end the pause; one waiting on the bank shows its page.
    if (result.payment !== 'needs-action') onAwait('noPause');
  };
  return (
    <div className="hp-billing-changes">
      {failure && <FailureBanner failure={failure} />}
      {approveUrl && (
        <div>
          <Button variant="secondary" onClick={() => stripeNavigation.assign(approveUrl)}>
            {t('hosted.billing.switch.approve')}
          </Button>
        </div>
      )}
      {panel.kind === 'pauseScheduled' && (
        <div>
          <Button variant="secondary" onClick={() => endPause.mutate(undefined, { onSuccess: ended })} isLoading={endPause.isPending} keepLabelWhileLoading>
            {t('hosted.billing.action.dontPause')}
          </Button>
        </div>
      )}
      {panel.kind === 'paused' &&
        (open && month ? (
          <InPlaceConfirm
            variant="primary"
            message={sentence(t, 'hosted.billing.pause.resumeConfirm', { month: <Amount minor={month.minor} currency={month.currency} language={language} /> })}
            cancelLabel={t('hosted.billing.switch.notNow')}
            confirmLabel={t('hosted.billing.action.resumeNow')}
            busy={endPause.isPending}
            cancelWhileBusy={false}
            onCancel={cancel}
            onConfirm={() => endPause.mutate(undefined, { onSuccess: ended })}
          />
        ) : (
          <div>
            <Button ref={triggerRef} onClick={ask}>
              {t('hosted.billing.action.resumeNow')}
            </Button>
          </div>
        ))}
      {canKeepOf(billing) && (
        <div>
          <Button variant="secondary" onClick={() => keep.mutate(undefined, { onSuccess: () => onAwait('noCancel') })} isLoading={keep.isPending} keepLabelWhileLoading>
            {t('hosted.billing.cancel.keep')}
          </Button>
        </div>
      )}
      {canCancelOf(billing) && (
        <div>
          <button type="button" className="hp-link-button hp-billing-cancel-link" onClick={onCancelPlan}>
            {t('hosted.billing.cancel.action')}
          </button>
        </div>
      )}
    </div>
  );
}

/** R2's rule for Resume now: Stripe's page to approve a charge the bank holds, only ever a stripe.com URL. */
function approveUrlOf(result: PauseEndResult | undefined): string | null {
  const url = result?.payment === 'needs-action' ? result.hostedInvoiceUrl : null;
  if (!url) return null;
  try {
    assertStripeUrl(url);
    return url;
  } catch {
    return null;
  }
}

function SwitchedBanner({ result, language }: { result: YearlySwitchResult; language: Language }) {
  const t = useT();
  return (
    <Banner
      tone="ok"
      text={sentence(t, 'hosted.billing.switch.done', {
        date: result.renewsOn ? formatInstant(result.renewsOn, language, browserTimezone()) : '',
        yearly: <Amount minor={result.yearlyAmount} currency={result.currency} language={language} />,
      })}
    />
  );
}

function Action({ view, busy, failure, onSubscribe, onPortal }: { view: BillingView; busy: boolean; failure: Failure; onSubscribe: () => void; onPortal: (flow?: 'card') => void }) {
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
    case 'updateCard':
    case 'payInPortal':
      return (
        <div className="hp-billing-action">
          <Button
            variant={view.action === 'manage' ? 'secondary' : 'primary'}
            onClick={() => onPortal(view.action === 'updateCard' ? 'card' : undefined)}
            isLoading={busy}
            keepLabelWhileLoading
            aria-busy={busy}
          >
            {t(`hosted.billing.action.${view.action}`)}
          </Button>
          {/* DR4: a failure shows under the button that failed. DR6: Stripe's page is in English, said before it opens. */}
          {failure && <FailureBanner failure={failure} />}
          <p className="hp-billing-fine">{t('hosted.billing.manageNote')}</p>
        </div>
      );
    case 'contactUs':
      return <ContactUs />;
    default:
      return null;
  }
}

/**
 * DR12: both currencies until the person picks a country; yearly prices in the fine print. MUT-525 DD10c: while the
 * person gets the launch offer, the year reads as its first-year price with the list price struck (DD9a).
 */
function PlanLines({ catalog, offer, language }: { catalog: BillingOverview['catalog']; offer: ReturnType<typeof eligibleOfferOf>; language: Language }) {
  const t = useT();
  const pairs = (['ILS', 'USD'] as const).flatMap((currency) => (catalog[currency] ? [{ currency, ...catalog[currency]! }] : []));
  const firstYearOf = (currency: 'ILS' | 'USD') => offer?.firstYear[currency] ?? null;
  const anyOffer = pairs.some((p) => firstYearOf(p.currency) !== null);
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
        {pairs.map((p, i) => {
          const firstYear = firstYearOf(p.currency);
          return (
            <span key={p.currency}>
              {i > 0 && ' / '}
              {firstYear === null ? (
                <Amount minor={p.year} currency={p.currency} language={language} />
              ) : (
                <OfferPrice firstYear={firstYear} list={p.year} currency={p.currency} language={language} />
              )}
            </span>
          );
        })}
        {anyOffer && <span aria-hidden="true"> {t('hosted.billing.offer.firstYear')}</span>}
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
  if (e.source === 'STRIPE' && e.paused === true) return { kind: 'paused', until: e.until };
  if (e.source === 'STRIPE') return e.state === 'READ_ONLY' ? { kind: 'lapsed' } : { kind: 'active', renewsAt: e.until ?? '', interval: null };
  return { kind: 'none' };
}

/**
 * The Subscribe step's choices and its Continue, kept in BillingDrawer so the button can live in the pinned footer (DR10).
 * MUT-525 DD5: the interval is decided once, on the first billing data (Yearly while the person gets the launch offer,
 * else Monthly), by a render-time adjustment; refetches never change it, only the person's tap does. DD4: an offer the
 * server says has ended is never shown or sent again in this drawer.
 */
function useSubscribeForm(billing: BillingOverview | undefined) {
  const { pathname } = useLocation();
  const [country, setCountry] = useState('');
  const [buyer, setBuyer] = useState<'person' | 'business'>('person');
  const [chosen, setBillingInterval] = useState<'month' | 'year' | null>(null);
  /** The offer the drawer opened with (DD5: its disappearing while open is said). */
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  /** The offer a Continue was refused for (DD4, 409 OFFER_ENDED). */
  const [refusedOffer, setRefusedOffer] = useState<string | null>(null);
  // Render-time adjustment, not an effect (react-hooks v7): set once, on the first render with billing data.
  if (chosen === null && billing) {
    const opening = eligibleOfferOf(billing);
    setBillingInterval(opening ? 'year' : 'month');
    setOpenedWith(opening?.id ?? null);
  }
  const interval = chosen ?? 'month';
  const checkout = useStartCheckout();
  const route = billing ? checkoutRouteOf(country || null, buyer, billing.countries) : null;
  const currency = country ? currencyOfCountry(country) : null;
  const pair = billing && currency ? billing.catalog[currency] : null;
  const eligible = billing ? eligibleOfferOf(billing) : null;
  const activeOffer = eligible && eligible.id !== refusedOffer ? eligible : null;
  const offer = billing && activeOffer ? offerFor(billing, currency, new Date()) : null;
  /** The offer is on screen: before a country is picked, or in the chosen currency. */
  const offerShown = activeOffer !== null && (currency === null || offer !== null);
  /** The offer this Continue would carry: Yearly, in the chosen currency. */
  const applied = interval === 'year' ? offer : null;
  /**
   * MUT-534 (D14): the come-back price for the chosen interval and currency, when the server says the person may have it
   * and the launch offer isn't what this Continue carries. Its amounts come from the server (ADR-004).
   */
  const offeredBack = comebackOfferOf(billing);
  const comeback = offeredBack && offeredBack.id !== refusedOffer && !applied ? offeredBack : null;
  const comebackPrice =
    comeback && currency
      ? { first: (interval === 'year' ? comeback.firstYear : comeback.firstMonth)[currency], list: (interval === 'year' ? comeback.listYear : comeback.listMonth)[currency] }
      : null;
  const comebackShown = comeback !== null && comebackPrice !== null && comebackPrice.first !== null && comebackPrice.list !== null;
  const comebackEnded = refusedOffer !== null && refusedOffer === offeredBack?.id;
  const offerEnded: 'withPrice' | 'whileOpen' | null = refusedOffer !== null && !comebackEnded ? 'withPrice' : openedWith !== null && activeOffer === null ? 'whileOpen' : null;
  const canContinue = route !== null && route !== 'contact-us' && pair !== null && !checkout.isPending;
  const submit = () => {
    if (!canContinue || !currency) return;
    const expectedOffer = applied?.id ?? (comebackShown ? comeback!.id : null);
    checkout.mutate(
      {
        interval,
        country,
        buyer,
        returnPath: billingReturnPath(pathname),
        ...(expectedOffer ? { expectedOffer } : {}),
      },
      {
        onSuccess: () => void trackPortal('billing_checkout_started', { interval, currency, offer: expectedOffer ? offerAnalyticsName(expectedOffer) : null }),
        onError: (error) => {
          if (expectedOffer && error instanceof ApiError && apiErrorReason(error) === 'OFFER_ENDED') setRefusedOffer(expectedOffer);
        },
      },
    );
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
    activeOffer,
    offer,
    offerShown,
    applied,
    offerEnded,
    comebackPrice: comebackShown ? (comebackPrice as { first: number; list: number }) : null,
    comebackEnded,
    canContinue,
    submit,
  };
}

type SubscribeForm = ReturnType<typeof useSubscribeForm>;

function SubscribeFooter({ form }: { form: SubscribeForm }) {
  const t = useT();
  const failure = failureOf(form.checkout.error);
  return (
    <div className="hp-billing-footer">
      {/* DR4: a failed Continue says so right above the pinned button, never off-screen in the scrolled body. */}
      {failure && <FailureBanner failure={failure} />}
      <Button
        className="hp-billing-continue"
        onClick={form.submit}
        disabled={!form.canContinue}
        isLoading={form.checkout.isPending}
        keepLabelWhileLoading
        aria-busy={form.checkout.isPending}
      >
        {t('hosted.billing.subscribe.continue')}
      </Button>
    </div>
  );
}

function SubscribeBody({ billing, title, form, onBack }: { billing: BillingOverview; title: string; form: SubscribeForm; onBack: () => void }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const ids = useId();
  const body = useRef<HTMLDivElement>(null);
  const { country, buyer, interval, route, currency, pair, activeOffer, offerShown, applied } = form;
  const firstCharge = firstChargeOf(billing, new Date());
  const saving = pair ? yearlySavingOf(pair) : null;
  const yearlyNote =
    !saving || !currency
      ? null
      : saving.kind === 'monthsFree'
        ? tp('hosted.billing.subscribe.monthsFree', saving.months)
        : t('hosted.billing.subscribe.save', {
            amount: formatMinor(saving.amount, currency, language),
          });
  // MUT-525 DD2: while the offer is on screen the Yearly segment stays short; otherwise today's label (R3).
  const yearlyLabel = offerShown
    ? t('hosted.billing.offer.segment')
    : yearlyNote
      ? `${t('hosted.billing.subscribe.yearly')} · ${yearlyNote}`
      : t('hosted.billing.subscribe.yearly');
  const summarised = route !== 'contact-us' && pair !== null && currency !== null;
  const amount = (minor: number) => (currency ? <Amount minor={minor} currency={currency} language={language} /> : null);

  // DR10: entering the step puts focus on its heading: the drawer's own title, which already reads the step's name.
  useEffect(() => {
    const titleHeading = body.current?.closest('.drawer')?.querySelector<HTMLElement>('.drawer-title');
    if (!titleHeading) return;
    titleHeading.tabIndex = -1;
    titleHeading.focus();
  }, []);

  return (
    <div className="hp-billing" ref={body} aria-label={title}>
      {/* MUT-525: the banner slot. DD4: the server refused the offer at Continue; DD5: it ended while this was open. */}
      {form.offerEnded === 'withPrice' && pair ? (
        <Banner tone="info" text={sentence(t, 'hosted.billing.offer.endedPrice', { list: amount(pair.year) })} />
      ) : (
        form.offerEnded !== null && <Banner tone="info" text={t('hosted.billing.offer.ended')} />
      )}
      <button type="button" className="hp-billing-back" onClick={onBack}>
        {t('hosted.billing.subscribe.back')}
      </button>
      {/* MUT-534 (D14): the server refused the come-back price at Continue; nothing was charged. */}
      {form.comebackEnded && <Banner tone="info" text={t('hosted.billing.comeback.ended')} />}
      {/* MUT-525 DD6: the offer reads first, before a country is picked; the step's order is unchanged. */}
      {offerShown && activeOffer && <OfferTopLine offer={activeOffer} place="drawer" endsToday />}
      {/* MUT-534 (D14): the welcome-back price, once a country sets the currency it is in. */}
      {form.comebackPrice && (
        <Banner
          tone="info"
          text={sentence(t, `hosted.billing.comeback.${form.interval === 'year' ? 'yearly' : 'monthly'}`, { first: amount(form.comebackPrice.first), list: amount(form.comebackPrice.list) })}
        />
      )}

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
              note: t(billing.countries.consumerEverywhere ? 'hosted.billing.subscribe.personNoteEverywhere' : 'hosted.billing.subscribe.personNote'),
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
            { value: 'year', label: yearlyLabel },
          ]}
        />
        {/* MUT-525 DD9d: on Monthly, one quiet line says what Yearly would bring. */}
        {offerShown && activeOffer && interval === 'month' && (
          <p className="hp-offer-fine">{t('hosted.billing.offer.monthlyHint', { date: offerDay(activeOffer.endsAt, language) })}</p>
        )}
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
            {/* DD9c: the price is announced when it changes (only while the offer can change it; R3 keeps today's markup). */}
            <span aria-live={offerShown ? 'polite' : undefined}>
              {applied ? (
                <>
                  <OfferPrice firstYear={applied.firstYear} list={applied.list} currency={currency} language={language} />
                  <span aria-hidden="true"> {t('hosted.billing.offer.firstYear')}</span>
                </>
              ) : (
                <>
                  <Amount minor={pair[interval]} currency={currency} language={language} />{' '}
                  {t(interval === 'month' ? 'hosted.billing.subscribe.perMonth' : 'hosted.billing.subscribe.perYear')}
                </>
              )}
            </span>
          </div>
        )
      )}
      {summarised && applied ? (
        <>
          {/* DD10a: one sentence for the first charge and the renewal replaces the loose fine lines (DD2's "then ₪290 a
              year · offer ends", whose end date the top line already says); "Prices exclude VAT" stays (plan §6). */}
          <p className="hp-billing-fine">
            {applied.firstChargeAt
              ? sentence(t, 'hosted.billing.offer.firstChargeTrial', {
                  firstCharge: offerDay(applied.firstChargeAt, language),
                  price: amount(applied.firstYear),
                  list: amount(applied.list),
                  renewsOn: offerDay(applied.renewsOn, language),
                })
              : sentence(t, 'hosted.billing.offer.firstChargeNow', { price: amount(applied.firstYear), list: amount(applied.list), renewsOn: offerDay(applied.renewsOn, language) })}
          </p>
          <p className="hp-billing-fine">{t('hosted.billing.plan.vat')}</p>
        </>
      ) : (
        firstCharge && <p className="hp-billing-fine">{t('hosted.billing.subscribe.firstCharge', { date: formatInstant(firstCharge, language, browserTimezone()) })}</p>
      )}
      <p className="hp-billing-fine">{t('hosted.billing.subscribe.headsUp')}</p>
      {billing.catalog.ILS === null && billing.catalog.USD === null && <Banner tone="info" text={t('hosted.billing.openSoon')} />}
    </div>
  );
}

/**
 * MUT-418: the first-run step's state. Open only once billing has loaded (the trial end and whether a card can be
 * taken both come from it). Every way out but "Add a card now" is "Not now" (D13); each answer is stored once, on
 * the server, so the step never comes back on any device (D1).
 */
function useTrialWelcome(active: boolean, billing: BillingOverview | undefined, onStep: BillingDrawerProps['onStep'], onClose: () => void) {
  const me = useMe();
  const answer = useAnswerTrialPrompt();
  // Review: a hand-typed or stale `?step=welcome` with no running trial (or under 48 h of one) shows the status view,
  // never "Your 14-day free trial has started".
  const open = active && billing !== undefined && trialWelcomeApplies(me, new Date());
  const sellable = billing ? isSellable(billing) : false;
  const endsAt = billing?.trial?.endsAt ?? me.profiles.find((p) => p.isPersonalDefault)?.billing?.until ?? null;
  const accept = () => {
    answer.mutate('welcome-accepted');
    void trackPortal('trial_card_prompt_accepted', { prompt: 'first_run' });
    onStep('subscribe', true);
  };
  const skip = () => {
    if (active) {
      answer.mutate('welcome-skipped');
      void trackPortal('trial_card_prompt_skipped', { prompt: 'first_run' });
    }
    onClose();
  };
  return { open, sellable, endsAt, accept, skip };
}

type TrialWelcome = ReturnType<typeof useTrialWelcome>;

function WelcomeBody({ welcome }: { welcome: TrialWelcome }) {
  const t = useT();
  const { language } = useLanguage();
  const headline = useRef<HTMLHeadingElement>(null);
  const shown = useRef(false);
  const tp = useTp();
  const date = welcome.endsAt ? formatInstant(welcome.endsAt, language, browserTimezone()) : '';
  // Review: someone first signing in days into the trial (an approval that waited) reads the days left, not "has started".
  const left = welcome.endsAt ? daysLeft(welcome.endsAt, new Date()) : TRIAL_LENGTH_DAYS;
  const heading = left >= TRIAL_LENGTH_DAYS - 1 ? t('hosted.billing.welcome.headline') : tp('hosted.billing.headline.trialDaysLeft', left);
  useEffect(() => {
    headline.current?.focus();
    if (shown.current) return;
    shown.current = true;
    void trackPortal('trial_card_prompt_shown', { prompt: 'first_run' });
  }, []);
  return (
    <div className="hp-billing hp-billing-welcome">
      <div className="hp-billing-status">
        <Chip tone="butter" label={t('hosted.billing.chip.trial')} />
        <h3 ref={headline} tabIndex={-1} className="hp-billing-headline">
          {heading}
        </h3>
        {date && <p>{t('hosted.billing.welcome.endsOn', { date })}</p>}
      </div>
      {/* AC4: no price pair, no card action, and nothing that pretends otherwise (D5). */}
      {welcome.sellable ? <p className="hp-billing-welcome-pitch">{t('hosted.billing.welcome.pitch', { date })}</p> : <Banner tone="info" text={t('hosted.billing.openSoon')} />}
      <p className="hp-billing-fine">{t('hosted.billing.welcome.later')}</p>
    </div>
  );
}

function WelcomeFooter({ welcome }: { welcome: TrialWelcome }) {
  const t = useT();
  if (!welcome.sellable) {
    return (
      <div className="hp-billing-footer">
        <Button className="hp-billing-continue" onClick={welcome.skip}>
          {t('hosted.billing.welcome.continue')}
        </Button>
      </div>
    );
  }
  return (
    <div className="hp-billing-footer">
      <Button className="hp-billing-continue" onClick={welcome.accept}>
        {t('hosted.billing.welcome.addCard')}
      </Button>
      <Button className="hp-billing-continue" variant="secondary" onClick={welcome.skip}>
        {t('hosted.billing.welcome.notNow')}
      </Button>
    </div>
  );
}

/**
 * What a failed Stripe hand-off tells the person (review): help from us, already subscribed, too many tries, or that
 * their billing changed (a refusal the drawer's view didn't predict; billingQueries refreshes it). Only a Stripe or
 * network failure says "try again".
 */
function failureOf(error: Error | null): Failure {
  if (!error) return null;
  if (!(error instanceof ApiError)) return 'sessionFailed';
  const reason = apiErrorReason(error);
  // MUT-525 DD4: an ended offer is said in the drawer's banner slot, with the yearly price, not as a failure.
  if (reason === 'OFFER_ENDED') return null;
  if (reason === 'BILLING_ACCOUNT_NEEDS_HELP' || reason === 'CONTACT_US') return 'needsHelp';
  if (reason === 'ALREADY_SUBSCRIBED') return 'alreadySubscribed';
  if (error.code === 'RATE_LIMITED') return 'tooMany';
  if (error.code === 'CONFLICT' || error.code === 'VALIDATION_FAILED' || error.code === 'BILLING_NOT_CONFIGURED') return 'changed';
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

function Chip({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`hp-billing-chip hp-billing-chip-${tone}`}>{label}</span>;
}

/**
 * MUT-525 DD9a: the first-year price, then the list price struck, each in its own <bdi>. The pair is hidden from
 * screen readers, which read one sentence instead ("₪145 for the first year instead of ₪290").
 */
function OfferPrice({ firstYear, list, currency, language }: { firstYear: number; list: number; currency: 'ILS' | 'USD'; language: Language }) {
  const t = useT();
  return (
    <>
      <span className="sr-only">{t('hosted.billing.offer.srPrice', { price: formatMinor(firstYear, currency, language), list: formatMinor(list, currency, language) })}</span>
      <span aria-hidden="true">
        <bdi className="hp-amount hp-offer-price">{formatMinor(firstYear, currency, language)}</bdi>{' '}
        <s className="hp-offer-list">
          <bdi className="hp-amount">{formatMinor(list, currency, language)}</bdi>
        </s>
      </span>
    </>
  );
}
