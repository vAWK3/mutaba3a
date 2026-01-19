import { useState, useRef, useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  useReceiptsByMonth,
  useUnlinkedReceipts,
  useCreateReceipt,
  useDeleteReceipt,
  useLinkReceiptToExpense,
  useUnlinkReceipt,
  useExpenses,
  useUnlinkedReceiptsWithSuggestions,
} from '../../hooks/useExpenseQueries';
import { useBusinessProfile } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatDate, cn } from '../../lib/utils';
import { exportReceiptsAsZip } from '../../lib/zipExport';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { ReceiptMatchList } from './components';
import { BulkUploadDrawer } from '../../components/drawers/BulkUploadDrawer';
import type { Receipt, ExpenseDisplay } from '../../types';
import './ReceiptsPage.css';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function ReceiptsPage() {
  const { profileId } = useParams({ from: '/expenses/profile/$profileId/receipts' });
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const currentDate = new Date();
  const [monthKey, setMonthKey] = useState(
    `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
  );
  const [activeTab, setActiveTab] = useState<'all' | 'inbox' | 'suggestions'>('all');
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [linkingReceipt, setLinkingReceipt] = useState<Receipt | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);

  const { openExpenseDrawer } = useDrawerStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profile, isLoading: profileLoading } = useBusinessProfile(profileId);
  const { data: monthReceipts = [], isLoading: receiptsLoading } = useReceiptsByMonth(profileId, monthKey);
  const { data: unlinkedReceipts = [] } = useUnlinkedReceipts(profileId);
  const { data: unlinkedWithSuggestions = [], isLoading: suggestionsLoading } =
    useUnlinkedReceiptsWithSuggestions(profileId);

  // Get expenses for linking
  const expenseFilters = useMemo(() => ({
    profileId,
    year: parseInt(monthKey.split('-')[0]),
    month: parseInt(monthKey.split('-')[1]),
  }), [profileId, monthKey]);
  const { data: expenses = [] } = useExpenses(expenseFilters);

  const createReceiptMutation = useCreateReceipt();
  const deleteReceiptMutation = useDeleteReceipt();
  const linkReceiptMutation = useLinkReceiptToExpense();
  const unlinkReceiptMutation = useUnlinkReceipt();

  // Generate month options (12 months back)
  const monthOptions = useMemo(() => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
      options.push({ key, label });
    }
    return options;
  }, [locale]);

  // Display receipts based on tab
  const displayReceipts = activeTab === 'inbox' ? unlinkedReceipts : monthReceipts;

  // Stats
  const linkedCount = monthReceipts.filter((r) => r.expenseId).length;
  const unlinkedCount = monthReceipts.filter((r) => !r.expenseId).length;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError('');

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(t('expenses.receipts.fileTooLarge', { maxSize: '5MB' }));
        continue;
      }

      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        setUploadError(t('expenses.receipts.invalidFileType'));
        continue;
      }

      try {
        const base64 = await readFileAsBase64(file);
        await createReceiptMutation.mutateAsync({
          profileId,
          monthKey,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          data: base64,
        });
      } catch {
        setUploadError(t('expenses.receipts.uploadFailed'));
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleLinkToExpense = async (expenseId: string) => {
    if (!linkingReceipt) return;

    try {
      await linkReceiptMutation.mutateAsync({
        receiptId: linkingReceipt.id,
        expenseId,
      });
      setLinkingReceipt(null);
    } catch {
      // Error handling
    }
  };

  const handleUnlink = async (receiptId: string) => {
    if (confirm(t('expenses.receipts.confirmUnlink'))) {
      await unlinkReceiptMutation.mutateAsync(receiptId);
    }
  };

  const handleDelete = async (receiptId: string) => {
    if (confirm(t('expenses.receipts.confirmDelete'))) {
      await deleteReceiptMutation.mutateAsync(receiptId);
      setSelectedReceipt(null);
    }
  };

  const handleExportZip = async () => {
    if (!profile || monthReceipts.length === 0) return;

    setIsExporting(true);
    try {
      await exportReceiptsAsZip(profileId, profile.name, monthKey);
    } catch (err) {
      console.error('Failed to export receipts:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCreateExpenseFromReceipt = (receipt: Receipt) => {
    // Open the expense drawer with prefilled data from receipt
    openExpenseDrawer({
      mode: 'create',
      defaultProfileId: profileId,
      prefillData: {
        vendor: receipt.vendorRaw,
        amountMinor: receipt.amountMinor,
        currency: receipt.currency,
        occurredAt: receipt.occurredAt,
      },
      linkReceiptId: receipt.id,
    });
  };

  if (profileLoading) {
    return (
      <>
        <TopBar
          title={t('common.loading')}
          breadcrumbs={[
            { label: t('nav.expenses'), href: '/expenses' },
            { label: t('common.loading'), href: `/expenses/profile/${profileId}` },
          ]}
        />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <TopBar
          title={t('expenses.profileNotFound')}
          breadcrumbs={[{ label: t('nav.expenses'), href: '/expenses' }]}
        />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.profileNotFound')}</h3>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={t('expenses.receipts.title')}
        breadcrumbs={[
          { label: t('nav.expenses'), href: '/expenses' },
          { label: profile.name, href: `/expenses/profile/${profileId}` },
          { label: t('expenses.receipts.title') },
        ]}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <select
              className="select"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
            >
              {monthOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="page-content">
        {/* Stats */}
        <div className="receipts-stats">
          <div className="receipts-stat">
            <span className="receipts-stat-value">{monthReceipts.length}</span>
            <span className="receipts-stat-label">{t('expenses.receipts.total')}</span>
          </div>
          <div className="receipts-stat">
            <span className="receipts-stat-value text-success">{linkedCount}</span>
            <span className="receipts-stat-label">{t('expenses.receipts.linked')}</span>
          </div>
          <div className="receipts-stat">
            <span className="receipts-stat-value text-warning">{unlinkedCount}</span>
            <span className="receipts-stat-label">{t('expenses.receipts.unlinked')}</span>
          </div>
        </div>

        {/* Upload & Export */}
        <div className="receipts-upload-section">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={createReceiptMutation.isPending}
          >
            {createReceiptMutation.isPending
              ? t('expenses.receipts.uploading')
              : t('expenses.receipts.upload')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setIsBulkUploadOpen(true)}
          >
            {t('bulkUpload.button')}
          </button>
          {monthReceipts.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={handleExportZip}
              disabled={isExporting}
            >
              {isExporting
                ? t('expenses.receipts.exporting')
                : t('expenses.receipts.exportZip')}
            </button>
          )}
          {uploadError && <span className="text-danger text-sm">{uploadError}</span>}
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 16 }}>
          <div className="tabs-list">
            <button
              className={cn('tab', activeTab === 'all' && 'active')}
              onClick={() => setActiveTab('all')}
            >
              {t('expenses.receipts.allTab')} ({monthReceipts.length})
            </button>
            <button
              className={cn('tab', activeTab === 'inbox' && 'active')}
              onClick={() => setActiveTab('inbox')}
            >
              {t('expenses.receipts.inboxTab')} ({unlinkedReceipts.length})
            </button>
            <button
              className={cn('tab', activeTab === 'suggestions' && 'active')}
              onClick={() => setActiveTab('suggestions')}
            >
              {t('expenses.receipts.suggestionsTab')} ({unlinkedWithSuggestions.length})
            </button>
          </div>
        </div>

        {/* Suggestions Tab Content */}
        {activeTab === 'suggestions' ? (
          <ReceiptMatchList
            items={unlinkedWithSuggestions}
            isLoading={suggestionsLoading}
            onLinkSuccess={() => {
              // Queries are automatically invalidated by the mutation
            }}
            onCreateExpense={handleCreateExpenseFromReceipt}
            groupByConfidence
          />
        ) : receiptsLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : displayReceipts.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.receipts.empty')}</h3>
            <p className="empty-state-description">{t('expenses.receipts.emptyHint')}</p>
          </div>
        ) : (
          <div className="receipts-grid">
            {displayReceipts.map((receipt) => (
              <div
                key={receipt.id}
                className={cn(
                  'receipt-card',
                  !receipt.expenseId && 'unlinked',
                  selectedReceipt?.id === receipt.id && 'selected'
                )}
                onClick={() => setSelectedReceipt(receipt)}
              >
                <div className="receipt-thumbnail">
                  {receipt.mimeType.startsWith('image/') ? (
                    <img src={`data:${receipt.mimeType};base64,${receipt.data}`} alt="" />
                  ) : (
                    <div className="receipt-pdf-icon">
                      <PdfIcon />
                    </div>
                  )}
                </div>
                <div className="receipt-info">
                  <div className="receipt-filename" title={receipt.fileName}>
                    {receipt.fileName}
                  </div>
                  <div className="receipt-meta">
                    <span className="text-muted text-sm">
                      {formatDate(receipt.createdAt, locale)}
                    </span>
                    {receipt.expenseId ? (
                      <span className="receipt-status linked">{t('expenses.receipts.linked')}</span>
                    ) : (
                      <span className="receipt-status unlinked">{t('expenses.receipts.unlinked')}</span>
                    )}
                  </div>
                </div>
                <div className="receipt-actions">
                  {receipt.expenseId ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnlink(receipt.id);
                      }}
                    >
                      {t('expenses.receipts.unlink')}
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkingReceipt(receipt);
                      }}
                    >
                      {t('expenses.receipts.link')}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(receipt.id);
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Link Modal */}
        {linkingReceipt && (
          <div className="modal-overlay" onClick={() => setLinkingReceipt(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">{t('expenses.receipts.linkToExpense')}</h3>
                <button className="modal-close" onClick={() => setLinkingReceipt(null)}>
                  &times;
                </button>
              </div>
              <div className="modal-body">
                {expenses.length === 0 ? (
                  <p className="text-muted">{t('expenses.receipts.noExpensesToLink')}</p>
                ) : (
                  <div className="link-expense-list">
                    {expenses.map((expense: ExpenseDisplay) => (
                      <button
                        key={expense.id}
                        className="link-expense-item"
                        onClick={() => handleLinkToExpense(expense.id)}
                      >
                        <div className="link-expense-info">
                          <span className="link-expense-title">
                            {expense.title || expense.vendor || t('expenses.untitled')}
                          </span>
                          <span className="link-expense-date">
                            {formatDate(expense.occurredAt, locale)}
                          </span>
                        </div>
                        <span className="link-expense-amount amount-negative">
                          {expense.currency} {(expense.amountMinor / 100).toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Receipt Preview Modal */}
        {selectedReceipt && (
          <div className="modal-overlay" onClick={() => setSelectedReceipt(null)}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">{selectedReceipt.fileName}</h3>
                <button className="modal-close" onClick={() => setSelectedReceipt(null)}>
                  &times;
                </button>
              </div>
              <div className="modal-body receipt-preview-body">
                {selectedReceipt.mimeType.startsWith('image/') ? (
                  <img
                    src={`data:${selectedReceipt.mimeType};base64,${selectedReceipt.data}`}
                    alt=""
                    className="receipt-preview-image"
                  />
                ) : (
                  <iframe
                    src={`data:${selectedReceipt.mimeType};base64,${selectedReceipt.data}`}
                    className="receipt-preview-pdf"
                    title={selectedReceipt.fileName}
                  />
                )}
              </div>
              <div className="modal-footer">
                <a
                  href={`data:${selectedReceipt.mimeType};base64,${selectedReceipt.data}`}
                  download={selectedReceipt.fileName}
                  className="btn btn-secondary"
                >
                  {t('expenses.receipts.download')}
                </a>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(selectedReceipt.id)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Upload Drawer */}
        <BulkUploadDrawer
          profileId={profileId}
          isOpen={isBulkUploadOpen}
          onClose={() => setIsBulkUploadOpen(false)}
          onSuccess={() => {
            setIsBulkUploadOpen(false);
          }}
        />
      </div>
    </>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function PdfIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}
