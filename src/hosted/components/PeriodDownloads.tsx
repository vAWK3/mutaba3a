import { useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { Button } from '../../components/ui/Button';
import type { PeriodDownloadTicket, PeriodDownloadType } from '../api/client';
import { AS_OF_REFRESH_MS, aboutSize, downloadProblem, submitDownload, type DownloadProblem, type Mint } from '../data/periodDownload';

/**
 * MUT-562 (AW3, SL3; Basel 13244: the download follows the period only, both sheets whatever the type filter): the
 * period's two downloads, "Excel report" and "Receipts (zip)". Opening the panel mints both tickets with one `asOf`,
 * so their Refs agree and each shows what it holds (entries; receipts and about how big); pressing one mints that file
 * again (same `asOf`) and posts the fresh ticket, so an expired or spent one is never posted (review fix 5). A panel
 * open past 20 hours takes a new `asOf` (the server takes at most 24 hours back), and a 422 AS_OF mints once more with
 * a new one. Over a cap the button is off with a hint.
 * Used by the client book (a profile mint) and a share link's page (the link's mint).
 */

/** A new `asOf` and when the panel took it (event handlers only, never during render). */
function freshWindow(): { asOf: string; openedAt: number } {
  const now = Date.now();
  return { asOf: new Date(now).toISOString(), openedAt: now };
}

function isStale(window: { openedAt: number }): boolean {
  return Date.now() - window.openedAt > AS_OF_REFRESH_MS;
}

type Slot = { kind: 'loading' } | { kind: 'ready'; ticket: PeriodDownloadTicket; mintedAt: number; spent: boolean } | { kind: 'problem'; problem: DownloadProblem };
const TYPES: readonly PeriodDownloadType[] = ['report', 'receipts'];

interface PeriodDownloadsProps {
  mint: Mint;
  viewerToken?: string;
  /** Called once a file's form went to the stream (the period_downloaded count). */
  onDownloaded: (type: PeriodDownloadType) => void;
}

export function PeriodDownloads({ mint, viewerToken, onDownloaded }: PeriodDownloadsProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<{ asOf: string; openedAt: number } | null>(null);
  const [slots, setSlots] = useState<Record<PeriodDownloadType, Slot>>({ report: { kind: 'loading' }, receipts: { kind: 'loading' } });

  /** Mints one file into its slot; a stale `asOf` (422 AS_OF) is taken again once. Returns the ticket, or null. */
  async function mintInto(type: PeriodDownloadType, asOf: string, retried = false): Promise<PeriodDownloadTicket | null> {
    try {
      const ticket = await mint(type, asOf);
      setSlots((current) => ({ ...current, [type]: { kind: 'ready', ticket, mintedAt: Date.now(), spent: false } }));
      return ticket;
    } catch (error) {
      const problem = downloadProblem(error);
      if (problem.kind === 'asOf' && !retried) {
        const window = freshWindow();
        setOpen(window);
        return mintInto(type, window.asOf, true);
      }
      setSlots((current) => ({ ...current, [type]: { kind: 'problem', problem } }));
      return null;
    }
  }

  function openPanel() {
    const window = freshWindow();
    setOpen(window);
    setSlots({ report: { kind: 'loading' }, receipts: { kind: 'loading' } });
    for (const type of TYPES) void mintInto(type, window.asOf);
  }

  async function download(type: PeriodDownloadType) {
    if (!open) return;
    // Open past 20 hours: a new asOf for this and later downloads (the estimates are minted again with it)
    let asOf = open.asOf;
    if (isStale(open)) {
      const window = freshWindow();
      setOpen(window);
      asOf = window.asOf;
    }
    const fresh = await mintInto(type, asOf);
    if (!fresh) return;
    submitDownload(fresh.ticket, viewerToken);
    setSlots((current) => ({ ...current, [type]: { kind: 'ready', ticket: fresh, mintedAt: Date.now(), spent: true } }));
    onDownloaded(type);
  }

  if (!open) {
    return (
      <section className="hp-downloads" aria-label={t('hosted.clientBooks.download.label')}>
        <Button variant="secondary" className="hp-block" onClick={openPanel}>
          {t('hosted.clientBooks.download.label')}
        </Button>
      </section>
    );
  }
  return (
    <section className="hp-downloads hp-downloads-open" aria-label={t('hosted.clientBooks.download.label')}>
      {TYPES.map((type) => (
        <DownloadRow key={type} type={type} slot={slots[type]} onDownload={() => void download(type)} />
      ))}
      <p className="hp-field-hint">{t('hosted.clientBooks.download.followsPeriod')}</p>
    </section>
  );
}

function DownloadRow({ type, slot, onDownload }: { type: PeriodDownloadType; slot: Slot; onDownload: () => void }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const label = t(type === 'report' ? 'hosted.clientBooks.download.report' : 'hosted.clientBooks.download.receipts');
  const estimate = slot.kind === 'ready' ? slot.ticket.estimate : null;
  const detail = !estimate
    ? null
    : type === 'report'
      ? tp('hosted.clientBooks.download.entries', estimate.expenses + estimate.income)
      : estimate.receipts === 0
        ? t('hosted.clientBooks.download.noReceipts')
        : `${tp('hosted.clientBooks.table.receipts', estimate.receipts)} · ${t('hosted.clientBooks.download.about', { size: aboutSize(estimate.receiptBytes, language) })}`;
  const off = slot.kind !== 'ready' || (type === 'receipts' && estimate?.receipts === 0);
  return (
    <div className="hp-download-row">
      <Button variant="primary" size="sm" onClick={onDownload} disabled={off} aria-describedby={`dl-${type}`}>
        {label}
      </Button>
      <span className={slot.kind === 'problem' ? 'hp-field-error' : 'hp-field-hint'} id={`dl-${type}`} role={slot.kind === 'problem' ? 'alert' : undefined}>
        {slot.kind === 'loading' ? t('hosted.clientBooks.table.loading') : slot.kind === 'problem' ? <ProblemText problem={slot.problem} /> : detail}
      </span>
    </div>
  );
}

export function ProblemText({ problem }: { problem: DownloadProblem }) {
  const { t } = useLanguage();
  const tp = useTp();
  if (problem.kind === 'tooLarge') return <>{t('hosted.clientBooks.download.tooLarge')}</>;
  if (problem.kind === 'rateLimited') return <>{tp('hosted.clientBooks.download.rateLimited', problem.minutes)}</>;
  if (problem.kind === 'unavailable') return <>{t('hosted.clientBooks.download.unavailable')}</>;
  return <>{t('hosted.clientBooks.download.failed')}</>;
}
