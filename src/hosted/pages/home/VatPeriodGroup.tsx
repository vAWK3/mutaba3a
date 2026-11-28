import { useId } from 'react';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { Scene, type SceneName } from '../../components/Scene';
import { VatPeriodIcon } from '../../components/VatIcons';
import { useMarkVatPeriodDone } from '../../data/vatPeriodQueries';
import { canSayDone, vatDueWords, vatPeriodWords, type VatPeriodView, type VatState } from '../client-books/vatPeriodRules';

/** The scene beside each state (Claude Design); an open period has none yet, only the period's own icon. */
const SCENE: Record<VatState, SceneName | null> = { OPEN: null, CLIENT_DONE: 'receipts-sent', CONFIRMED: 'period-confirmed', MORE_NEEDED: 'more-needed' };
const SCENE_SIZE = 56;

/**
 * MUT-783: the client's VAT period on home (Waiting lane): "VAT · Jan – Feb", the filing day and one Done, then what the
 * accountant did with it. Done is one tap and cannot be tapped twice (the button is gone once the period is done). No
 * money. The caller hides the group when there is nothing to show (`clientVatVisible`).
 */
export function VatPeriodGroup({ profileId, period }: { profileId: string; period: VatPeriodView }) {
  const { t, language } = useLanguage();
  const headingId = useId();
  const done = useMarkVatPeriodDone(profileId);
  const due = vatDueWords(period.due, language);
  const scene = SCENE[period.state];
  const line =
    period.state === 'OPEN'
      ? due
      : period.state === 'CLIENT_DONE'
        ? t('hosted.vat.client.waiting')
        : period.state === 'CONFIRMED'
          ? t('hosted.vat.client.confirmed')
          : t('hosted.vat.client.more');

  return (
    <section className="hp-home-group hp-vat" aria-labelledby={headingId} data-state={period.state}>
      <div className="hp-home-group-head">
        <h2 id={headingId}>{t('hosted.vat.title', { period: vatPeriodWords(period, language) })}</h2>
      </div>
      <div className="hp-vat-row">
        <span className="hp-vat-art" aria-hidden="true">
          {scene ? <Scene name={scene} size={SCENE_SIZE} /> : <VatPeriodIcon width={28} height={28} />}
        </span>
        <div className="hp-vat-text">
          {line && <p className="hp-vat-line">{line}</p>}
          {period.state === 'MORE_NEEDED' && period.note && (
            <p className="hp-muted" dir="auto">
              {period.note}
            </p>
          )}
        </div>
        {canSayDone(period.state) && (
          <Button type="button" size="sm" onClick={() => done.mutate(period.periodKey)} isLoading={done.isPending} keepLabelWhileLoading>
            {t('hosted.vat.done')}
          </Button>
        )}
      </div>
      {done.isError && (
        <p className="hp-field-error" role="alert">
          {t('hosted.vat.failed')}
        </p>
      )}
    </section>
  );
}
