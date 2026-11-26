import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { Button } from '../../../components/ui/Button';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { useLanguage } from '../../../lib/i18n/core';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { ReceiptCard } from '../../components/ReceiptCard';
import { SectionTabs } from '../../components/SectionTabs';
import { DEFAULT_RECEIPT_STATUS, type ReceiptStatusFilter, type ReceiptsPageSearch } from '../../data/filters';
import { mayMoveExpensesFrom } from '../../data/profileRules';
import { RECEIPT_MIME_TYPES } from '../../data/receiptFileRules';
import { useReceiptCounts, useReceipts, useReceiptsAvailability, type PendingUpload } from '../../data/receiptQueries';
import { useReceiptFiles } from '../../data/useReceiptFiles';
import { PlanLimitNotice } from '../../components/PlanLimitNotice';
import { useMe, useProfile, useWriteGate } from '../../session/me';
import type { HostedProfile } from '../../api/client';
import { MoveExpenseDrawer } from '../../components/MoveExpenseDrawer';
import { MoveReceiptDrawerHost } from '../../components/MoveReceiptDrawer';
import { hasOtherProfiles, useExpenseMovedToast, useMovedToast } from '../../components/useMovedToast';
import { useExpensesTabs } from './ExpenseGroupsList';
import { PageHeader, ShowMore } from './shared';

/**
 * Expenses › Receipts (MUT-260 D1, layout B): the profile's receipts library as a thumbnail gallery, To review by
 * default (Filed and All beside it, each with its count), and Upload receipt (D9). A card opens its review page. When
 * the library is off (the counts answer 404 or 503, D4/A11) the page says so instead. A read-only profile browses
 * and opens originals, with nothing to upload (D11).
 */
const SKELETON_ROWS = 3;
/** DR4: how long a moved card takes to leave (--duration-toggle) before focus moves on. */
const LEAVE_MS = 260;

export interface ReceiptsGalleryProps {
  search: ReceiptsPageSearch;
  setSearch: (next: ReceiptsPageSearch) => void;
}

export function ReceiptsUnavailable() {
  const { t } = useLanguage();
  return <Empty title={t('hosted.receipts.unavailable.title')} />;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const status: ReceiptStatusFilter = search.status ?? DEFAULT_RECEIPT_STATUS;
  const list = useReceipts(profile.id, status);
  const counts = useReceiptCounts(profile.id);
  const me = useMe();
  const navigate = useNavigate();
  const movedToast = useMovedToast();
  // MUT-503 (DR2): no Move where there is nowhere to move to, or nothing may be written here.
  const canMove = writable && hasOtherProfiles(me, profile.id);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const reviewPath = (id: string) => `/p/${profile.id}/expenses/receipts/${id}`;
  const closeMove = () => setSearch({ ...search, move: undefined });
  // MUT-589: a filed receipt moves with its expense (the expense's own move drawer), offered only to an owner of a
  // profile Malafat doesn't feed; anyone else sees no such item.
  const canMoveExpense = canMove && mayMoveExpensesFrom(profile);
  const expenseMovedToast = useExpenseMovedToast();
  const closeExpenseMove = () => setSearch({ ...search, moveExpense: undefined });
  const onExpenseMoved = (target: HostedProfile) => {
    const id = search.moveExpense;
    closeExpenseMove();
    if (id) expenseMovedToast(target, id);
  };
  /** DR4: the card leaves, focus goes to its neighbour (or the tabs when it was the last), the toast names where it went. */
  const onMoved = (target: HostedProfile) => {
    const id = search.move;
    if (!id) return;
    const ids = list.data?.map((item) => item.id) ?? [];
    const at = ids.indexOf(id);
    const neighbour = ids[at + 1] ?? ids[at - 1] ?? null;
    setLeavingId(id);
    closeMove();
    movedToast(target, id);
    window.setTimeout(() => {
      const next = neighbour ? document.querySelector<HTMLElement>(`[data-receipt-id="${neighbour}"] .hp-receipt-card-link`) : null;
      (next ?? document.querySelector<HTMLElement>('.hp-receipts-bar [role="tab"][aria-selected="true"], .hp-receipts-bar button'))?.focus();
    }, LEAVE_MS);
  };
  // The search as it is when an upload finishes, not as it was when it started (the person may have switched tabs).
  const latestSearch = useRef(search);
  useEffect(() => {
    latestSearch.current = search;
  });

  // AC2: an upload lands in To review, so show that list (unless the person moved to All meanwhile).
  const uploads = useReceiptFiles(profile.id, {
    onLanded: () => {
      if (latestSearch.current.status === 'filed') setSearch({ ...latestSearch.current, status: undefined });
    },
  });
  const onFiles = uploads.onFiles;

  // One file input for the page; the toolbar's and the empty state's buttons both open it.
  const fileInput = writable ? (
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
  ) : null;
  const uploadButton = writable ? (
    <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()} disabled={uploads.uploading}>
      {t(uploads.uploading ? 'hosted.receipts.uploading' : 'hosted.receipts.upload')}
    </Button>
  ) : null;

  const options: { value: ReceiptStatusFilter; label: string; count?: number }[] = [
    { value: 'to_review', label: t('hosted.receipts.status.to_review'), count: counts.data?.toReview },
    { value: 'filed', label: t('hosted.receipts.status.filed'), count: counts.data?.filed },
    { value: 'all', label: t('hosted.receipts.status.all') },
  ];

  return (
    <>
      {fileInput}
      {/* MUT-731 (wireframe 2): Starter's scans used up; the expense can still be added by hand. */}
      {uploads.planLimit && <PlanLimitNotice limit={uploads.planLimit} onByHand={uploads.byHand} />}
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
        empty={<Empty title={t(`hosted.receipts.empty.${status}.title`)} body={status === 'all' ? t('hosted.receipts.empty.all.body') : undefined} action={uploadButton} />}
      >
        {(items) => (
          <>
            <ul className="hp-receipts-grid" aria-label={t('hosted.receipts.listLabel')}>
              {status !== 'filed' && uploads.pending.map((p) => <UploadingCard key={p.key} pending={p} />)}
              {items.map((item) => (
                <ReceiptCard
                  key={item.id}
                  profileId={profile.id}
                  item={item}
                  to={reviewPath(item.id)}
                  leaving={item.id === leavingId}
                  actions={
                    canMove && item.filingStatus === 'TO_REVIEW'
                      ? [
                          { label: t('hosted.receipts.move.open'), onSelect: () => void navigate({ to: reviewPath(item.id) }) },
                          { label: t('hosted.receipts.move.action'), onSelect: () => setSearch({ ...search, move: item.id }) },
                        ]
                      : canMoveExpense && item.filingStatus === 'FILED' && item.expenseId
                        ? [
                            { label: t('hosted.receipts.move.open'), onSelect: () => void navigate({ to: reviewPath(item.id) }) },
                            { label: t('hosted.expenses.move.withExpense'), onSelect: () => setSearch({ ...search, moveExpense: item.expenseId! }) },
                          ]
                        : undefined
                  }
                />
              ))}
            </ul>
            <ShowMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
      {search.move && canMove && <MoveReceiptDrawerHost profile={profile} receiptId={search.move} onClose={closeMove} onMoved={onMoved} />}
      {search.moveExpense && canMoveExpense && <MoveExpenseDrawer profile={profile} expenseId={search.moveExpense} onClose={closeExpenseMove} onMoved={onExpenseMoved} />}
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
