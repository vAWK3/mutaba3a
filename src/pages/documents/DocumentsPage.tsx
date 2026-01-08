import { useState, useMemo } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs, DateRangeControl } from '../../components/filters';
import { EmptyState, RowActionsMenu } from '../../components/ui';
import { CheckIcon } from '../../components/icons';
import { useDocuments, useMarkDocumentPaid, useVoidDocument, useIssueDocument } from '../../hooks/useQueries';
import { formatAmount, formatDate, getDateRangePreset } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, DocumentType, DocumentStatus, DocumentFilters } from '../../types';

// Document type display labels
const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  invoice_receipt: 'Invoice Receipt',
  credit_note: 'Credit Note',
  price_offer: 'Price Offer',
  proforma_invoice: 'Proforma',
  donation_receipt: 'Donation',
};

// Status display config
const STATUS_CONFIG: Record<DocumentStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'badge badge-muted' },
  issued: { label: 'Issued', className: 'badge badge-warning' },
  paid: { label: 'Paid', className: 'badge badge-success' },
  voided: { label: 'Voided', className: 'badge badge-danger' },
};

export function DocumentsPage() {
  const navigate = useNavigate();
  const markPaidMutation = useMarkDocumentPaid();
  const voidMutation = useVoidDocument();
  const issueDocumentMutation = useIssueDocument();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  // Filters state
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('all'));
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<DocumentType | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | undefined>(undefined);
  const [search, setSearch] = useState('');

  // Build query filters
  const queryFilters = useMemo((): DocumentFilters => {
    return {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      currency,
      type: typeFilter,
      status: statusFilter,
      search: search || undefined,
      sort: { by: 'issueDate', dir: 'desc' },
    };
  }, [dateRange, currency, typeFilter, statusFilter, search]);

  const { data: documents = [], isLoading } = useDocuments(queryFilters);

  const handleRowClick = (id: string) => {
    navigate({ to: '/documents/$documentId', params: { documentId: id } });
  };

  return (
    <>
      <TopBar
        title="Documents"
        filterSlot={
          <div
            className="filters-row"
            style={{ marginBottom: 0, marginInlineStart: 24, flexWrap: 'nowrap' }}
          >
            <DateRangeControl
              dateFrom={dateRange.dateFrom}
              dateTo={dateRange.dateTo}
              onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
            />
            <CurrencyTabs value={currency} onChange={setCurrency} />
          </div>
        }
      />
      <div className="page-content">
        <div className="filters-row">
          {/* Document Type Filter */}
          <select
            className="select"
            value={typeFilter || ''}
            onChange={(e) => setTypeFilter((e.target.value as DocumentType) || undefined)}
          >
            <option value="">All Types</option>
            <option value="invoice">Invoice</option>
            <option value="receipt">Receipt</option>
            <option value="invoice_receipt">Invoice Receipt</option>
            <option value="credit_note">Credit Note</option>
            <option value="price_offer">Price Offer</option>
            <option value="proforma_invoice">Proforma Invoice</option>
            <option value="donation_receipt">Donation Receipt</option>
          </select>

          {/* Status Filter */}
          <select
            className="select"
            value={statusFilter || ''}
            onChange={(e) => setStatusFilter((e.target.value as DocumentStatus) || undefined)}
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="paid">Paid</option>
            <option value="voided">Voided</option>
          </select>

          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search documents..."
          />
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description={search ? 'No documents match your search' : 'Create your first document to get started'}
            action={{
              label: 'New Document',
              onClick: () => navigate({ to: '/documents/new' }),
            }}
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Client</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th style={{ textAlign: 'end' }}>Amount</th>
                  <th>Status</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="clickable" onClick={() => handleRowClick(doc.id)}>
                    <td>
                      <Link
                        to="/documents/$documentId"
                        params={{ documentId: doc.id }}
                        onClick={(e) => e.stopPropagation()}
                        className="link"
                      >
                        {doc.number}
                      </Link>
                    </td>
                    <td>
                      <span className="badge badge-muted">{DOCUMENT_TYPE_LABELS[doc.type]}</span>
                    </td>
                    <td className="text-secondary">{doc.clientName || '-'}</td>
                    <td>{formatDate(doc.issueDate, locale)}</td>
                    <td className="text-secondary">
                      {doc.dueDate ? formatDate(doc.dueDate, locale) : '-'}
                    </td>
                    <td className="amount-cell amount-positive">
                      {formatAmount(doc.totalMinor, doc.currency, locale)}
                    </td>
                    <td>
                      <span className={STATUS_CONFIG[doc.status].className}>
                        {STATUS_CONFIG[doc.status].label}
                      </span>
                    </td>
                    <td>
                      <RowActionsMenu
                        actions={[
                          // View action
                          {
                            label: 'View',
                            onClick: () => {
                              // Navigate to detail page instead of drawer
                              window.location.href = `/documents/${doc.id}`;
                            },
                          },
                          // Issue document (only for drafts)
                          ...(doc.status === 'draft'
                            ? [
                                {
                                  label: 'Issue Document',
                                  onClick: () => issueDocumentMutation.mutate(doc.id),
                                },
                              ]
                            : []),
                          // Mark as paid (only for issued invoices)
                          ...(doc.status === 'issued' && doc.type === 'invoice'
                            ? [
                                {
                                  label: t('common.markPaid'),
                                  icon: <CheckIcon size={16} />,
                                  onClick: () => markPaidMutation.mutate(doc.id),
                                },
                              ]
                            : []),
                          // Void (only for issued documents)
                          ...(doc.status === 'issued'
                            ? [
                                {
                                  label: 'Void',
                                  variant: 'danger' as const,
                                  onClick: () => {
                                    if (confirm('Are you sure you want to void this document?')) {
                                      voidMutation.mutate(doc.id);
                                    }
                                  },
                                },
                              ]
                            : []),
                          // Create credit note (for paid invoices)
                          ...(doc.status === 'paid' && doc.type === 'invoice'
                            ? [
                                {
                                  label: 'Create Credit Note',
                                  onClick: () =>
                                    navigate({ to: '/documents/new' }),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
