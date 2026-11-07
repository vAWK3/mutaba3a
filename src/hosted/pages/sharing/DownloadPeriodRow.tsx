import { useId, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { useLanguage } from '../../../lib/i18n/core';
import { api, type HostedProfile, type PeriodDownloadTicket, type PeriodDownloadType } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { formatSize } from '../../format/dates';
import { postDownload, usePeriodDownloadsOn } from '../../data/periodDownload';
import { dayIn, downloadErrorOf, monthName, monthOptions, monthSpan, monthsLabel, type Line } from './sharingRules';

/**
 * MUT-561 + MUT-314 (Basel, MUT-558 13244): the owner's own "Download a period", at the bottom of the Sharing page.
 * Whole months (up to 24, none in the future), then the Excel report or the receipts zip. Pressing one asks the server
 * for a ticket, which says what the period holds (its size), and Download posts the ticket so the browser saves the
 * file. Both files from one visit share one `asOf`, so their Refs agree. Hidden where the server has period downloads
 * off (404).
 */

/** The server takes an `asOf` at most 24 hours back: a page open longer starts a fresh one. */
const AS_OF_MAX_AGE_MS = 23 * 60 * 60 * 1000;

interface Prepared {
  ticket: PeriodDownloadTicket;
  from: string;
  to: string;
}

export function DownloadPeriodRow({ profile }: { profile: HostedProfile }) {
  const on = usePeriodDownloadsOn(profile.id);
  if (on.data !== true) return null;
  return <DownloadPeriodBody profile={profile} />;
}

function DownloadPeriodBody({ profile }: { profile: HostedProfile }) {
  const { t, language } = useLanguage();
  const ids = useId();
  const months = monthOptions(dayIn(new Date(), profile.timezone));
  const [from, setFrom] = useState(months[1] ?? months[0]);
  const [to, setTo] = useState(months[1] ?? months[0]);
  const [asOf, setAsOf] = useState<{ at: string; from: string; to: string } | null>(null);
  const [busy, setBusy] = useState<PeriodDownloadType | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [message, setMessage] = useState<{ line: Line; error: boolean } | null>(null);

  const span = monthSpan(from, to);
  const range = monthsLabel(`${from}-01`, `${to}-01`, language) ?? monthName(to, language);

  /** One asOf per period, reused by both files (MUT-314: their Refs agree), renewed past 23 hours. */
  const asOfFor = () => {
    if (asOf && asOf.from === from && asOf.to === to && Date.now() - Date.parse(asOf.at) < AS_OF_MAX_AGE_MS) return asOf.at;
    const at = new Date().toISOString();
    setAsOf({ at, from, to });
    return at;
  };

  const ticketFor = (type: PeriodDownloadType, at: string) => api.periodDownloadTicket(profile.id, { type, from, to, asOf: at, lang: language });

  const prepare = async (type: PeriodDownloadType) => {
    if (busy || span < 1) return;
    setMessage(null);
    setPrepared(null);
    setBusy(type);
    try {
      setPrepared({ ticket: await ticketFor(type, asOfFor()), from, to });
    } catch (error) {
      setMessage({ line: downloadErrorOf(error), error: true });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!prepared || busy) return;
    const { type } = prepared.ticket;
    let ticket = prepared.ticket;
    // A ticket lives 120 seconds: an older one is replaced with the same asOf, so the file still matches the estimate
    if (Date.parse(ticket.expiresAt) <= Date.now()) {
      setBusy(type);
      try {
        ticket = await ticketFor(type, asOfFor());
      } catch (error) {
        setMessage({ line: downloadErrorOf(error), error: true });
        return;
      } finally {
        setBusy(null);
      }
    }
    postDownload(ticket.ticket);
    void trackPortal('period_downloaded', { place: 'owner', file: type, months: monthSpan(prepared.from, prepared.to) });
    setPrepared(null);
    setMessage({ line: { key: 'hosted.sharing.download.started' }, error: false });
  };

  const changeFrom = (value: string) => {
    setFrom(value);
    if (monthSpan(value, to) < 1) setTo(value);
    setPrepared(null);
  };
  const changeTo = (value: string) => {
    setTo(value);
    if (monthSpan(from, value) < 1) setFrom(value);
    setPrepared(null);
  };

  const estimate = (ticket: PeriodDownloadTicket) =>
    ticket.type === 'report'
      ? t('hosted.sharing.download.reportEstimate', { months: range, expenses: String(ticket.estimate.expenses), income: String(ticket.estimate.income) })
      : t('hosted.sharing.download.receiptsEstimate', { months: range, count: String(ticket.estimate.receipts), size: formatSize(ticket.estimate.receiptBytes, language) });

  return (
    <section className="hp-sharing-download" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>{t('hosted.sharing.download.title')}</h2>
      <p className="hp-sharing-note">{t('hosted.sharing.download.note')}</p>
      <div className="hp-sharing-download-range">
        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-from`}>
            {t('hosted.sharing.download.from')}
          </label>
          <Select id={`${ids}-from`} value={from} onChange={(event) => changeFrom(event.target.value)}>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthName(month, language)}
              </option>
            ))}
          </Select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-to`}>
            {t('hosted.sharing.download.to')}
          </label>
          <Select id={`${ids}-to`} value={to} onChange={(event) => changeTo(event.target.value)}>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthName(month, language)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="hp-empty-actions hp-sharing-download-actions">
        {(['report', 'receipts'] as const).map((type) => (
          <Button key={type} type="button" variant="secondary" isLoading={busy === type} keepLabelWhileLoading aria-busy={busy === type || undefined} onClick={() => void prepare(type)}>
            {t(type === 'report' ? 'hosted.sharing.download.report' : 'hosted.sharing.download.receipts')}
          </Button>
        ))}
      </div>
      {prepared && (
        <div className="hp-sharing-download-ready" role="status">
          <p>{estimate(prepared.ticket)}</p>
          <div className="hp-empty-actions">
            <Button type="button" variant="secondary" onClick={() => setPrepared(null)}>
              {t('hosted.sharing.download.cancel')}
            </Button>
            <Button type="button" onClick={() => void download()}>
              {t('hosted.sharing.download.download')}
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className={message.error ? 'hp-banner hp-banner-error' : 'form-hint'} role={message.error ? 'alert' : 'status'}>
          {t(message.line.key, message.line.vars)}
        </p>
      )}
    </section>
  );
}
