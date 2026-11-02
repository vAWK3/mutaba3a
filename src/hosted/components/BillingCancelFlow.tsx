import { useEffect, useId, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { CancellationReason } from '../api/client';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { Amount, Banner } from './billingParts';
import { formatMinor, sentence } from './billingText';
import { InPlaceConfirm } from './InPlaceConfirm';
import { RadioCards } from './RadioCards';
import { CANCEL_COMMENT_MAX, CANCEL_REASONS, type CancelFlow, type PauseMonths } from './useCancelFlow';

/**
 * MUT-532 (plan D8, §3, §6): Billing's own cancel flow, in the drawer's body (`?step=cancel`; DESIGN.md: one drawer, its
 * body swapped). Why? → Pause instead? → the stay offer → Confirm cancel. Each step puts focus on its heading; the
 * step's choices sit in the pinned footer, except Confirm, whose destructive confirm stands in its place.
 */

export function CancelBody({ flow, onBack }: { flow: CancelFlow; onBack: () => void }) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [flow.phase]);
  return (
    <div className="hp-billing hp-billing-cancel">
      {flow.failure && <Banner tone="error" text={t(`hosted.billing.states.${flow.failure}`)} />}
      <button type="button" className="hp-billing-back" onClick={onBack} disabled={flow.busy}>
        {t('hosted.billing.subscribe.back')}
      </button>
      {flow.phase === 'why' && <WhyStep flow={flow} headingRef={heading} />}
      {flow.phase === 'pause' && <PauseStep flow={flow} headingRef={heading} />}
      {flow.phase === 'stay' && <StayStep flow={flow} headingRef={heading} />}
      {flow.phase === 'confirm' && <ConfirmStep flow={flow} headingRef={heading} onKeep={onBack} />}
    </div>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>;

/** The radio cards' values are strings; the months are the server's 1, 2 or 3. */
const PAUSE_MONTHS: Record<`${PauseMonths}`, PauseMonths> = { '1': 1, '2': 2, '3': 3 };

function WhyStep({ flow, headingRef }: { flow: CancelFlow; headingRef: HeadingRef }) {
  const t = useT();
  const ids = useId();
  return (
    <>
      <div className="hp-billing-status">
        <h3 ref={headingRef} tabIndex={-1} id={`${ids}-why`} className="hp-billing-headline">
          {t('hosted.billing.cancel.whyTitle')}
        </h3>
        <p>{t('hosted.billing.cancel.whyHint')}</p>
      </div>
      <RadioCards<CancellationReason>
        name={`${ids}-reason`}
        labelledBy={`${ids}-why`}
        value={flow.reason ?? ''}
        onChange={flow.setReason}
        options={CANCEL_REASONS.map((value) => ({ value, label: t(`hosted.billing.cancel.reason.${value}`), note: '' }))}
      />
      <Textarea
        id={`${ids}-comment`}
        label={t('hosted.billing.cancel.comment')}
        value={flow.comment}
        maxLength={CANCEL_COMMENT_MAX}
        rows={3}
        onChange={(e) => flow.setComment(e.target.value)}
      />
    </>
  );
}

function PauseStep({ flow, headingRef }: { flow: CancelFlow; headingRef: HeadingRef }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const ids = useId();
  const day = (iso: string) => formatInstant(iso, language, browserTimezone());
  const options = flow.retention?.pause?.options ?? [];
  const from = options[0]?.from;
  return (
    <>
      <div className="hp-billing-status">
        <h3 ref={headingRef} tabIndex={-1} id={`${ids}-pause`} className="hp-billing-headline">
          {t('hosted.billing.pause.title')}
        </h3>
        <p>{t('hosted.billing.pause.body')}</p>
      </div>
      <RadioCards<`${PauseMonths}`>
        name={`${ids}-months`}
        labelledBy={`${ids}-pause`}
        value={`${flow.months}`}
        onChange={(value) => flow.setMonths(PAUSE_MONTHS[value])}
        options={options.map((o) => ({ value: `${o.months as PauseMonths}`, label: tp('hosted.billing.pause.option', o.months, { date: day(o.until) }), note: '' }))}
      />
      {from && <p className="hp-billing-fine">{t('hosted.billing.pause.startsNote', { date: day(from) })}</p>}
      <p className="hp-billing-fine">{t('hosted.billing.pause.onceNote')}</p>
    </>
  );
}

function StayStep({ flow, headingRef }: { flow: CancelFlow; headingRef: HeadingRef }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const offer = flow.retention?.stayOffer;
  if (!offer) return null;
  const amount = (minor: number) => <Amount minor={minor} currency={offer.currency} language={language} />;
  const endsOn = flow.retention?.endsOn;
  return (
    <div className="hp-billing-status">
      <h3 ref={headingRef} tabIndex={-1} className="hp-billing-headline">
        {tp('hosted.billing.stay.title', offer.months, { percent: String(offer.percentOff) })}
      </h3>
      <p>{sentence(t, 'hosted.billing.stay.body', { price: amount(offer.monthlyAmount), list: amount(offer.listAmount) })}</p>
      {endsOn && <p className="hp-billing-fine">{t('hosted.billing.stay.onceNote', { date: formatInstant(endsOn, language, browserTimezone()) })}</p>}
    </div>
  );
}

function ConfirmStep({ flow, headingRef, onKeep }: { flow: CancelFlow; headingRef: HeadingRef; onKeep: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const endsOn = flow.retention?.endsOn;
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className="hp-billing-headline">
        {t('hosted.billing.cancel.confirmTitle')}
      </h3>
      <InPlaceConfirm
        message={t('hosted.billing.cancel.confirmBody', { date: endsOn ? formatInstant(endsOn, language, browserTimezone()) : '' })}
        cancelLabel={t('hosted.billing.cancel.keep')}
        confirmLabel={t('hosted.billing.cancel.confirm')}
        busy={flow.busy}
        cancelWhileBusy={false}
        onCancel={onKeep}
        onConfirm={flow.cancel}
      />
    </>
  );
}

/** Each step's choices, pinned under the body (DR10). Confirm has none: its in-place confirm holds them. */
export function CancelFooter({ flow }: { flow: CancelFlow }) {
  const t = useT();
  const { language } = useLanguage();
  const busy = flow.busy;
  switch (flow.phase) {
    case 'why':
      return (
        <div className="hp-billing-footer">
          <Button className="hp-billing-continue" onClick={flow.next} disabled={!flow.reason || flow.loading || flow.failure === 'changed'} isLoading={flow.loading} keepLabelWhileLoading>
            {t('hosted.billing.cancel.continue')}
          </Button>
        </div>
      );
    case 'pause':
      return (
        <div className="drawer-footer-right">
          <Button variant="secondary" onClick={flow.declinePause} disabled={busy}>
            {t('hosted.billing.pause.decline')}
          </Button>
          <Button onClick={flow.confirmPause} isLoading={busy} keepLabelWhileLoading aria-busy={busy}>
            {t('hosted.billing.pause.confirm')}
          </Button>
        </div>
      );
    case 'stay': {
      const offer = flow.retention?.stayOffer;
      return (
        <div className="drawer-footer-right">
          <Button variant="secondary" onClick={flow.cancel} disabled={busy}>
            {t('hosted.billing.stay.decline')}
          </Button>
          {offer && (
            <Button onClick={flow.acceptStay} isLoading={busy} keepLabelWhileLoading aria-busy={busy}>
              {t('hosted.billing.stay.accept', { price: formatMinor(offer.monthlyAmount, offer.currency, language) })}
            </Button>
          )}
        </div>
      );
    }
    case 'confirm':
      return null;
  }
}
