import { useRef } from 'react';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { Button } from '../../../components/ui/Button';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { ReceiptCard } from '../../components/ReceiptCard';
import { SectionTabs } from '../../components/SectionTabs';
import { useToast } from '../../components/Toast';
import { DEFAULT_RECEIPT_STATUS, type ReceiptStatusFilter, type ReceiptsPageSearch } from '../../data/filters';
import { RECEIPT_MIME_TYPES, checkReceiptFile } from '../../data/receiptFileRules';
import { uploadErrorOf, useReceiptCounts, useReceipts, useReceiptsAvailability, useUploadReceipts, type PendingUpload } from '../../data/receiptQueries';
import { useProfile, useWriteGate } from '../../session/me';
import { useExpensesTabs } from './ExpenseGroupsList';
import { PageHeader, ShowMore } from './shared';

/**
 * Expenses › Receipts (MUT-260 D1, layout B): the profile's receipts library as a thumbnail gallery, To review by
 * default (Filed and All beside it, each with its count), and Upload receipt (D9). A card opens its review page. When
 * the library is off (the counts answer 404 or 503, D4/A11) the page says so instead. A read-only profile browses
 * and opens originals, with nothing to upload (D11).
 */
const SKELETON_ROWS = 3;

export interface ReceiptsGalleryProps {
  search: ReceiptsPageSearch;
  setSearch: (next: ReceiptsPageSearch) => void;
}

export function ReceiptsUnavailable() {
  const { t } = useLanguage();
  return <Empty title={t('hosted.receipts.unavailable.title')} body={t('hosted.receipts.unavailable.body')} />;
}

export function ReceiptsGallery({ search, setSearch }: ReceiptsGalleryProps) {
  const profile = useProfile();
  const { t } = useLanguage();
  const { availability } = useReceiptsAvailability(profile.id);
  const tabs = useExpensesTabs();

  return (
    <>
      <PageHeader title={t('hosted.expenses.title')} />
      <SectionTabs {...tabs} />
      {availability === 'checking' && <Skeleton rows={SKELETON_ROWS} />}
      {availability === 'off' && <ReceiptsUnavailable />}
      {availability === 'on' && <GalleryBody search={search} setSearch={setSearch} />}
    </>
  );
}

function GalleryBody({ search, setSearch }: ReceiptsGalleryProps) {
  const profile = useProfile();
  const { writable } = useWriteGate();
  const { t } = useLanguage();
  const tp = useTp();
  const showToast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const status: ReceiptStatusFilter = search.status ?? DEFAULT_RECEIPT_STATUS;
  const list = useReceipts(profile.id, status);
  const counts = useReceiptCounts(profile.id);
  const uploads = useUploadReceipts(profile.id);

  const onFiles = async (files: File[]) => {
    const problems: string[] = [];
    const accepted = files.filter((file) => {
      const problem = checkReceiptFile(file);
      if (problem) problems.push(t(`hosted.receipts.errors.${problem}`, { name: file.name }));
      return !problem;
    });
    if (problems.length > 0) showToast(problems[0]);
    if (accepted.length === 0) return;
    const outcomes = await uploads.upload(accepted);
    const failed = outcomes.find((o) => o.error !== null);
    const landed = outcomes.filter((o) => o.error === null).length;
    if (failed) {
      const { key, seconds } = uploadErrorOf(failed.error);
      showToast(t(`hosted.receipts.errors.${key}`, { name: failed.file.name, seconds: seconds ?? 0 }));
    } else if (problems.length === 0 && landed > 0) {
      showToast(tp('hosted.receipts.uploaded', landed), { tone: 'info' });
    }
    // AC2: an upload lands in To review, so show that list.
    if (landed > 0 && status === 'filed') setSearch({ ...search, status: undefined });
  };

  const uploadButton = writable ? (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={RECEIPT_MIME_TYPES.join(',')}
        hidden
        data-testid="receipts-upload-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void onFiles(files);
        }}
      />
      <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()} disabled={uploads.uploading}>
        {t(uploads.uploading ? 'hosted.receipts.uploading' : 'hosted.receipts.upload')}
      </Button>
    </>
  ) : null;

  const options: { value: ReceiptStatusFilter; label: string; count?: number }[] = [
    { value: 'to_review', label: t('hosted.receipts.status.to_review'), count: counts.data?.toReview },
    { value: 'filed', label: t('hosted.receipts.status.filed'), count: counts.data?.filed },
    { value: 'all', label: t('hosted.receipts.status.all') },
  ];

  return (
    <>
      <div className="hp-receipts-bar">
        <SegmentedTabs<ReceiptStatusFilter>
          options={options}
          value={status}
          onChange={(next) => setSearch({ ...search, status: next === 'to_review' ? undefined : next })}
        />
        {uploadButton}
      </div>
      <QueryView
        queries={[list]}
        data={list.data}
        loading={<Skeleton rows={SKELETON_ROWS} />}
        isEmpty={(items) => items.length === 0 && uploads.pending.length === 0}
        empty={<Empty title={t(`hosted.receipts.empty.${status}.title`)} body={t(`hosted.receipts.empty.${status}.body`)} action={uploadButton} />}
      >
        {(items) => (
          <>
            <ul className="hp-receipts-grid" aria-label={t('hosted.receipts.listLabel')}>
              {status !== 'filed' && uploads.pending.map((p) => <UploadingCard key={p.key} pending={p} />)}
              {items.map((item) => (
                <ReceiptCard key={item.id} profileId={profile.id} item={item} to={`/p/${profile.id}/expenses/receipts/${item.id}`} />
              ))}
            </ul>
            <ShowMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
    </>
  );
}

function UploadingCard({ pending }: { pending: PendingUpload }) {
  const { t } = useLanguage();
  return (
    <li className="hp-receipt-card hp-receipt-card-uploading" aria-busy="true">
      <span className="hp-receipt-thumb">
        <BrandLoader size={24} delay={0} />
      </span>
      <span className="hp-receipt-card-meta">
        <bdi className="hp-receipt-card-day">{t('hosted.receipts.uploadingName', { name: pending.name })}</bdi>
      </span>
    </li>
  );
}
