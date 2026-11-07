import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLanguage } from '../../../lib/i18n/core';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Button } from '../../../components/ui/Button';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { api, ApiError, type ShareLinkUnlock } from '../../api/client';
import { countPublicPage } from '../../analytics/portalAnalytics';
import { PeriodDownloads } from '../../components/PeriodDownloads';
import { DecimalAmount } from '../../format/DecimalAmount';
import { Drawer } from '../../components/Drawer';
import { EntriesTable, linkRow, type EntryRow } from '../../components/EntriesTable';
import { SelectFilter } from '../../components/FilterControls';
import { Unreachable } from '../../components/QueryView';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { addMonths, firstDay, monthsBetween, periodLabel, type Month } from '../client-books/clientBooksRules';

/**
 * MUT-562: a share link once the PIN opened it (layout B, unlocked). "Shared with you by {owner} · {profile}" (SL1), a
 * lavender band with the period's totals per currency, a filter (All / Expenses / Income and a month of the range),
 * the entries table and each expense's receipts. Every read goes with the viewer token in the body and is keyed by
 * the link's digest, never under a profile. A 401 (8 hours up) or a 404 (ended, locked) goes back to the page.
 */

type KindChoice = 'all' | 'expense' | 'received';
const LINK_PAGE = 50;
/** The month select lists at most two years of months (a whole-profile link's last 24). */
const MAX_MONTH_CHOICES = 24;

interface ShareLinkViewProps {
  digest: string;
  unlock: ShareLinkUnlock;
  onViewFailed: (error: unknown) => void;
}

export function ShareLinkView({ digest, unlock, onViewFailed }: ShareLinkViewProps) {
  const { t, language } = useLanguage();
  const [kind, setKind] = useState<KindChoice>('all');
  const [month, setMonth] = useState<Month | undefined>(undefined);
  const [openRow, setOpenRow] = useState<EntryRow | null>(null);
  const viewerToken = unlock.viewerToken;
  const lastMonth = unlock.to.slice(0, 7);
  const firstMonth = unlock.from?.slice(0, 7) ?? null;
  const months = useMemo(() => monthChoices(firstMonth, lastMonth), [firstMonth, lastMonth]);

  const summary = useQuery({
    queryKey: ['shareLink', digest, 'summary', viewerToken],
    queryFn: ({ signal }) => api.shareLinkSummary(viewerToken, signal),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const filters = { kinds: kind === 'all' ? undefined : [kind], ...(month ? { occurredFrom: firstDay(month), occurredBefore: firstDay(addMonths(month, 1)) } : {}) };
  const entries = useInfiniteQuery({
    queryKey: ['shareLink', digest, 'entries', viewerToken, filters],
    queryFn: ({ pageParam, signal }) => api.shareLinkEntries({ viewerToken, limit: LINK_PAGE, ...(pageParam ? { cursor: pageParam } : {}), ...filters }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // A refusal (the 8 hours ended, the link ended or locked) belongs to the page, which leaves this view
  const refusal = [summary.error, entries.error].find((error) => error && isRefusal(error));
  useEffect(() => {
    if (refusal) onViewFailed(refusal);
  }, [refusal, onViewFailed]);

  const rows = useMemo(() => entries.data?.pages.flatMap((page) => page.items).map(linkRow) ?? [], [entries.data]);
  const range = firstMonth ? periodLabel(firstMonth, lastMonth, language) : t('hosted.shareLink.until', { month: periodLabel(lastMonth, lastMonth, language) });

  return (
    <div className="hp-two-panel hp-two-panel-wide">
      <header className="hp-two-panel-top">
        <Wordmark markSize={32} />
        <LanguageSwitch />
      </header>
      <main className="hp-share-view">
        <p className="hp-share-eyebrow">{t('hosted.shareLink.sharedBy')}</p>
        <h1 className="hp-share-title">
          {unlock.ownerName ? (
            <>
              <bdi dir="auto">{unlock.ownerName}</bdi> · <bdi dir="auto">{unlock.profileName}</bdi>
            </>
          ) : (
            <bdi dir="auto">{unlock.profileName}</bdi>
          )}
        </h1>

        <section className="hp-share-band" aria-label={t('hosted.shareLink.band.label')}>
          <span className="hp-share-band-period">
            {range} · {t('hosted.shareLink.readOnly')}
          </span>
          {summary.isPending ? (
            <BrandLoader size={24} />
          ) : summary.data ? (
            <BandTotals summary={summary.data} />
          ) : null}
          {/* SL3: the link's period, both files; a refusal of the viewer (8 hours up, ended) goes back to the page */}
          <PeriodDownloads
            viewerToken={viewerToken}
            mint={async (type, asOf) => {
              try {
                return await api.shareLinkDownloadTicket({ viewerToken, type, lang: language, asOf });
              } catch (error) {
                if (isRefusal(error)) onViewFailed(error);
                throw error;
              }
            }}
            onDownloaded={(file) => countPublicPage({ event: 'period_downloaded', properties: { place: 'link_page', file, ...(firstMonth ? { months: monthsBetween(firstMonth, lastMonth) } : {}) } })}
          />
        </section>

        <div className="hp-share-filters">
          <SegmentedControl<KindChoice>
            ariaLabel={t('hosted.shareLink.filter.label')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: t('hosted.shareLink.filter.all') },
              { value: 'expense', label: t('hosted.shareLink.filter.expenses') },
              { value: 'received', label: t('hosted.shareLink.filter.income') },
            ]}
          />
          <SelectFilter<Month>
            label={t('hosted.shareLink.filter.month')}
            value={month}
            onChange={setMonth}
            options={months.map((m) => ({ value: m, label: periodLabel(m, m, language) }))}
          />
        </div>

        {entries.isError && !refusal ? (
          <Unreachable onRetry={() => void entries.refetch()} />
        ) : entries.isPending ? (
          <div className="loading loading--section">
            <BrandLoader size={40} />
          </div>
        ) : rows.length === 0 ? (
          <p className="hp-muted">{t(kind === 'all' && !month ? 'hosted.clientBooks.table.empty' : 'hosted.clientBooks.table.emptyFiltered')}</p>
        ) : (
          <>
            <EntriesTable rows={rows} label={t('hosted.clientBooks.table.label')} onOpenReceipt={setOpenRow} openKey={openRow?.key ?? null} />
            {entries.hasNextPage && (
              <Button variant="secondary" onClick={() => void entries.fetchNextPage()} disabled={entries.isFetchingNextPage}>
                {t(entries.isFetchingNextPage ? 'hosted.clientBooks.table.loading' : 'hosted.clientBooks.table.loadMore')}
              </Button>
            )}
          </>
        )}
      </main>
      {openRow?.receiptRef && <LinkReceipts digest={digest} viewerToken={viewerToken} row={openRow} onClose={() => setOpenRow(null)} onViewFailed={onViewFailed} />}
    </div>
  );
}

function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 404);
}

/** The months a link covers, newest first, for the month select. */
function monthChoices(from: Month | null, to: Month): Month[] {
  const count = Math.min(MAX_MONTH_CHOICES, from ? monthsBetween(from, to) : MAX_MONTH_CHOICES);
  return Array.from({ length: count }, (_, index) => addMonths(to, -index));
}

function BandTotals({ summary }: { summary: Awaited<ReturnType<typeof api.shareLinkSummary>> }) {
  const { t } = useLanguage();
  const currencies = [...new Set([...summary.expenses.map((e) => e.currency), ...summary.received.map((r) => r.currency)])];
  if (currencies.length === 0) return <span>{t('hosted.shareLink.band.none')}</span>;
  return (
    <dl className="hp-share-band-totals">
      {currencies.map((currency) => {
        const spent = summary.expenses.find((e) => e.currency === currency)?.total ?? '0';
        const received = summary.received.find((r) => r.currency === currency)?.total ?? '0';
        return (
          <div key={currency} className="hp-share-band-currency">
            <dt>{t('hosted.shareLink.band.spent')}</dt>
            <dd>
              <DecimalAmount value={spent} currency={currency} />
            </dd>
            <dt>{t('hosted.shareLink.band.received')}</dt>
            <dd>
              <DecimalAmount value={received} currency={currency} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * An expense's receipts from the link: images inline; a PDF as a download (MUT-560 signs link URLs as attachments,
 * D11). URLs live a minute, so they are asked for when the pane opens and never cached past it.
 */
function LinkReceipts({ digest, viewerToken, row, onClose, onViewFailed }: { digest: string; viewerToken: string; row: EntryRow; onClose: () => void; onViewFailed: (error: unknown) => void }) {
  const { t } = useLanguage();
  const receipts = useQuery({
    queryKey: ['shareLink', digest, 'receipts', row.receiptRef],
    queryFn: () => api.shareLinkReceipts(viewerToken, row.receiptRef!),
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
  useEffect(() => {
    if (receipts.error instanceof ApiError && receipts.error.status === 401) onViewFailed(receipts.error);
  }, [receipts.error, onViewFailed]);
  return (
    <Drawer title={t('hosted.shareLink.receiptsTitle')} onClose={onClose} closeLabel={t('hosted.clientBooks.receipt.close')}>
      <p className="hp-receipt-pane-line">
        <bdi dir="auto">{row.what ?? t('hosted.clientBooks.table.untitled')}</bdi> · <DecimalAmount value={row.amount} currency={row.currency} />
      </p>
      {receipts.isPending ? (
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      ) : receipts.isError ? (
        <p className="hp-muted" role="alert">
          {t('hosted.clientBooks.receipt.failed')}
        </p>
      ) : (
        <ul className="hp-receipt-pane-list">
          {receipts.data.items.map((receipt) => (
            <li key={receipt.url}>
              {receipt.mimeType !== 'application/pdf' && <img src={receipt.url} alt={receipt.filename} className="hp-receipt-pane-image" referrerPolicy="no-referrer" />}
              <a className="hp-link" href={receipt.url} rel="noopener noreferrer" download={receipt.filename}>
                {t('hosted.shareLink.downloadReceipt', { name: receipt.filename })}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
