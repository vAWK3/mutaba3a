import { useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { Button } from '../../components/ui/Button';
import type { PeriodDownloadTicket, PeriodDownloadType } from '../api/client';
import { TICKET_FRESH_MS, aboutSize, downloadProblem, submitDownload, type DownloadProblem, type Mint } from '../data/periodDownload';

/**
 * MUT-562 (AW3, SL3; Basel 13244: the download follows the period only, both sheets whatever the type filter): the
 * period's two downloads, "Excel report" and "Receipts (zip)". Opening the panel mints both tickets with one `asOf`,
 * so their Refs agree and each shows what it holds (entries; receipts and about how big); pressing one posts its
 * ticket to the stream (minted again with the same `asOf` once it's old). Over a cap the button is off with a hint.
 * Used by the client book (a profile mint) and a share link's page (the link's mint).
 */

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
  const [open, setOpen] = useState<{ asOf: string } | null>(null);
  const [slots, setSlots] = useState<Record<PeriodDownloadType, Slot>>({ report: { kind: 'loading' }, receipts: { kind: 'loading' } });

  async function mintInto(type: PeriodDownloadType, asOf: string): Promise<PeriodDownloadTicket | null> {
    try {
      const ticket = await mint(type, asOf);
      setSlots((current) => ({ ...current, [type]: { kind: 'ready', ticket, mintedAt: Date.now(), spent: false } }));
      return ticket;
    } catch (error) {
      setSlots((current) => ({ ...current, [type]: { kind: 'problem', problem: downloadProblem(error) } }));
      return null;
    }
  }

  function openPanel() {
    const asOf = new Date().toISOString();
    setOpen({ asOf });
    setSlots({ report: { kind: 'loading' }, receipts: { kind: 'loading' } });
    for (const type of TYPES) void mintInto(type, asOf);
  }

  async function download(type: PeriodDownloadType) {
    if (!open) return;
    const slot = slots[type];
    const fresh = slot.kind === 'ready' && !slot.spent && Date.now() - slot.mintedAt < TICKET_FRESH_MS ? slot.ticket : await mintInto(type, open.asOf);
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
