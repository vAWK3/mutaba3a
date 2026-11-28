import { useId, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { Drawer } from '../../components/Drawer';
import { Scene } from '../../components/Scene';
import { AskMoreIcon, VatPeriodIcon } from '../../components/VatIcons';
import { useReviewVatPeriod, useSetClientVatPeriod } from '../../data/vatPeriodQueries';
import { VatBadge } from './VatBadge';
import { canReview, VAT_KINDS, vatDueWords, vatPeriodWords, type ClientVat, type VatKind } from './vatPeriodRules';

/** The accountant's note on Ask for more: the server's limit (VAT_PERIOD_NOTE_MAX). */
const NOTE_MAX = 200;

/**
 * MUT-783 (ADR-343): one client's VAT period on the desk (`/client-books?vat=<profileId>`): the latest period and where
 * it stands, Confirm or Ask for more (its own pane, with a note), and how often this client files. A refusal is a banner
 * at the top of the body (DESIGN.md); one drawer, panes swap rather than a drawer on a drawer.
 */
export function VatPeriodDrawer({ profileId, name, item, onClose }: { profileId: string; name: string; item: ClientVat | undefined; onClose: () => void }) {
  const { t, language } = useLanguage();
  const noteId = useId();
  const kindId = useId();
  const setKind = useSetClientVatPeriod();
  const review = useReviewVatPeriod();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const period = item?.period ?? null;

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setFailed(false);
    try {
      await action();
      after?.();
    } catch {
      setFailed(true);
    }
  };
  const confirm = () => period && run(() => review.mutateAsync({ profileId, periodKey: period.periodKey, decision: 'CONFIRMED' }));
  const ask = () =>
    period &&
    run(
      () => review.mutateAsync({ profileId, periodKey: period.periodKey, decision: 'MORE_NEEDED', ...(note.trim() ? { note: note.trim() } : {}) }),
      () => {
        setAsking(false);
        setNote('');
      },
    );
  const busy = review.isPending;

  const footer = asking ? (
    <div className="drawer-footer-right">
      <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </Button>
      <Button type="button" onClick={() => void ask()} isLoading={busy} keepLabelWhileLoading>
        {t('hosted.vat.ask')}
      </Button>
    </div>
  ) : period && canReview(period.state) ? (
    <div className="drawer-footer-right">
      <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
        <AskMoreIcon width={18} height={18} /> {t('hosted.vat.ask')}
      </Button>
      <Button type="button" onClick={() => void confirm()} isLoading={busy} keepLabelWhileLoading>
        {t('hosted.vat.confirm')}
      </Button>
    </div>
  ) : undefined;

  return (
    <Drawer title={name} onClose={onClose} closeLabel={t('common.close')} footer={footer}>
      {failed && (
        <div className="hp-banner hp-banner-error" role="alert">
          <span>{t('hosted.vat.failed')}</span>
        </div>
      )}
      {asking && period ? (
        <div className="form-group">
          <label className="form-label" htmlFor={noteId}>
            {t('hosted.vat.note')}
          </label>
          <textarea id={noteId} className="input" rows={4} maxLength={NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} dir="auto" autoFocus />
        </div>
      ) : (
        <>
          {period ? (
            <div className="hp-vat-drawer-period">
              <VatPeriodIcon width={24} height={24} />
              <div>
                <p className="hp-vat-line">{t('hosted.vat.title', { period: vatPeriodWords(period, language) })}</p>
                {vatDueWords(period.due, language) && <p className="hp-muted">{vatDueWords(period.due, language)}</p>}
              </div>
              <VatBadge state={period.state} />
            </div>
          ) : (
            <div className="hp-vat-unset" aria-hidden="true">
              <Scene name="period-unset" size={96} />
            </div>
          )}
          {period?.state === 'MORE_NEEDED' && period.note && (
            <p className="hp-muted" dir="auto">
              {period.note}
            </p>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor={kindId}>
              {t('hosted.vat.period.label')}
            </label>
            <select
              id={kindId}
              className="input"
              value={item?.kind ?? 'NONE'}
              disabled={setKind.isPending}
              onChange={(event) => void run(() => setKind.mutateAsync({ profileId, kind: event.target.value as VatKind }))}
            >
              {VAT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`hosted.vat.period.${kind}`)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </Drawer>
  );
}
