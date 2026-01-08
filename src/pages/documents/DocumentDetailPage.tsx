import { useState } from 'react';
import { Link, useParams, useNavigate } from '@tanstack/react-router';
import { PDFViewer, PDFDownloadLink } from '@react-pdf/renderer';
import { TopBar } from '../../components/layout';
import { CheckIcon, DownloadIcon } from '../../components/icons';
import {
  useDocument,
  useBusinessProfile,
  useClient,
  useMarkDocumentPaid,
  useVoidDocument,
  useIssueDocument,
  useUpdateDocument,
} from '../../hooks/useQueries';
import { formatAmount, formatDate } from '../../lib/utils';
import { useLanguage, getLocale } from '../../lib/i18n';
import { DocumentPdf } from '../../features/documents/pdf';
import type { DocumentType, DocumentStatus } from '../../types';
import type { TemplateId } from '../../features/documents/pdf/styles';

// Document type display labels
const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  invoice_receipt: 'Invoice Receipt',
  credit_note: 'Credit Note',
  price_offer: 'Price Offer',
  proforma_invoice: 'Proforma Invoice',
  donation_receipt: 'Donation Receipt',
};

// Status display config
const STATUS_CONFIG: Record<DocumentStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'badge badge-muted' },
  issued: { label: 'Issued', className: 'badge badge-warning' },
  paid: { label: 'Paid', className: 'badge badge-success' },
  voided: { label: 'Voided', className: 'badge badge-danger' },
};

export function DocumentDetailPage() {
  const params = useParams({ strict: false }) as { documentId: string };
  const documentId = params.documentId;
  const navigate = useNavigate();
  const markPaidMutation = useMarkDocumentPaid();
  const voidMutation = useVoidDocument();
  const issueDocumentMutation = useIssueDocument();
  const updateDocumentMutation = useUpdateDocument();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const [activeTab, setActiveTab] = useState<'preview' | 'details' | 'transactions'>('preview');
  const [isOriginal, setIsOriginal] = useState(true); // Default to "Original"

  // Query document and related data
  const { data: document, isLoading: docLoading } = useDocument(documentId);
  const { data: businessProfile } = useBusinessProfile(document?.businessProfileId || '');
  const { data: client } = useClient(document?.clientId || '');

  if (docLoading) {
    return (
      <>
        <TopBar title="Loading..." />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!document) {
    return (
      <>
        <TopBar title="Document Not Found" />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">Document not found</h3>
            <p className="empty-state-description">
              The document you're looking for doesn't exist or has been deleted.
            </p>
            <Link to="/documents" className="btn btn-primary">
              Back to Documents
            </Link>
          </div>
        </div>
      </>
    );
  }

  const canEdit = document.status === 'draft';
  const canIssue = document.status === 'draft';
  const canMarkPaid = document.status === 'issued' && document.type === 'invoice';
  const canVoid = document.status === 'issued';
  const canCreateCreditNote = document.status === 'paid' && document.type === 'invoice';

  // Handler for manual status changes
  const handleStatusChange = async (newStatus: DocumentStatus) => {
    if (newStatus === document.status) return;

    if (newStatus === 'paid') {
      markPaidMutation.mutate(document.id);
    } else if (newStatus === 'voided') {
      if (confirm('Are you sure you want to void this document?')) {
        voidMutation.mutate(document.id);
      }
    } else if (newStatus === 'issued') {
      issueDocumentMutation.mutate(document.id);
    } else {
      // For draft (reverting status), use generic update
      updateDocumentMutation.mutate({ id: document.id, data: { status: newStatus } });
    }
  };

  return (
    <>
      <TopBar
        title={document.number}
        breadcrumbs={[
          { label: 'Documents', href: '/documents' },
          { label: document.number },
        ]}
      />
      <div className="page-content">
        {/* Header with actions */}
        <div className="detail-header">
          <div className="detail-header-info">
            <div className="detail-header-meta">
              <span className={STATUS_CONFIG[document.status].className}>
                {STATUS_CONFIG[document.status].label}
              </span>
              <span className="badge badge-muted">{DOCUMENT_TYPE_LABELS[document.type]}</span>
              <span className="text-muted">
                {formatDate(document.issueDate, locale)}
              </span>
            </div>
            <div className="detail-header-stats">
              <div className="inline-stat">
                <span className="inline-stat-label">Total</span>
                <span className="inline-stat-value">
                  {formatAmount(document.totalMinor, document.currency, locale)}
                </span>
              </div>
              {document.dueDate && (
                <div className="inline-stat">
                  <span className="inline-stat-label">Due Date</span>
                  <span className="inline-stat-value">{formatDate(document.dueDate, locale)}</span>
                </div>
              )}
              {client && (
                <div className="inline-stat">
                  <span className="inline-stat-label">Client</span>
                  <span className="inline-stat-value">{client.name}</span>
                </div>
              )}
            </div>
          </div>
          <div className="detail-header-actions">
            {canEdit && (
              <Link
                to="/documents/$documentId/edit"
                params={{ documentId: document.id }}
                className="btn btn-secondary"
              >
                Edit
              </Link>
            )}
            {canMarkPaid && (
              <button
                className="btn btn-success"
                onClick={() => markPaidMutation.mutate(document.id)}
                disabled={markPaidMutation.isPending}
              >
                <CheckIcon size={16} />
                Mark as Paid
              </button>
            )}
            {canVoid && (
              <button
                className="btn btn-warning"
                onClick={() => {
                  if (confirm('Are you sure you want to void this document?')) {
                    voidMutation.mutate(document.id);
                  }
                }}
                disabled={voidMutation.isPending}
              >
                Void
              </button>
            )}
            {canCreateCreditNote && (
              <Link to="/documents/new" className="btn btn-secondary">
                Create Credit Note
              </Link>
            )}
            {/* Issue & Download for draft documents */}
            {canIssue && businessProfile && (
              <PDFDownloadLink
                document={
                  <DocumentPdf
                    document={document}
                    businessProfile={businessProfile}
                    client={client || undefined}
                    templateId={document.templateId as TemplateId}
                    isOriginal={isOriginal}
                  />
                }
                fileName={`${document.number}.pdf`}
                className="btn btn-primary"
                onClick={() => issueDocumentMutation.mutate(document.id)}
              >
                {({ loading }) => (loading || issueDocumentMutation.isPending ? 'Preparing...' : (
                  <>
                    <DownloadIcon size={16} />
                    Issue & Download PDF
                  </>
                ))}
              </PDFDownloadLink>
            )}
            {/* Download only for non-draft documents */}
            {!canIssue && businessProfile && (
              <PDFDownloadLink
                document={
                  <DocumentPdf
                    document={document}
                    businessProfile={businessProfile}
                    client={client || undefined}
                    templateId={document.templateId as TemplateId}
                    isOriginal={isOriginal}
                  />
                }
                fileName={`${document.number}.pdf`}
                className="btn btn-primary"
              >
                {({ loading }) => (loading ? 'Preparing...' : (
                  <>
                    <DownloadIcon size={16} />
                    Download PDF
                  </>
                ))}
              </PDFDownloadLink>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <div className="tabs-list">
            <button
              className={`tab ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              Preview
            </button>
            <button
              className={`tab ${activeTab === 'details' ? 'active' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              Details
            </button>
            <button
              className={`tab ${activeTab === 'transactions' ? 'active' : ''}`}
              onClick={() => setActiveTab('transactions')}
            >
              Linked Transactions ({document.linkedTransactionIds.length})
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'preview' && businessProfile && (
          <div className="pdf-preview-container">
            <div className="pdf-preview-toolbar">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={isOriginal}
                  onChange={(e) => setIsOriginal(e.target.checked)}
                />
                <span>Print as Original</span>
              </label>
              <span className={`badge ${isOriginal ? 'badge-success' : 'badge-muted'}`}>
                {isOriginal ? 'Original' : 'Copy'}
              </span>
            </div>
            <PDFViewer width="100%" height="600px" showToolbar={false}>
              <DocumentPdf
                document={document}
                businessProfile={businessProfile}
                client={client || undefined}
                templateId={document.templateId as TemplateId}
                isOriginal={isOriginal}
              />
            </PDFViewer>
          </div>
        )}

        {activeTab === 'details' && (
          <div className="detail-grid">
            <div className="detail-card">
              <h3>Document Information</h3>
              <dl className="detail-list">
                <dt>Number</dt>
                <dd>{document.number}</dd>
                <dt>Type</dt>
                <dd>{DOCUMENT_TYPE_LABELS[document.type]}</dd>
                <dt>Status</dt>
                <dd>
                  <select
                    className="select select-sm"
                    value={document.status}
                    onChange={(e) => handleStatusChange(e.target.value as DocumentStatus)}
                    disabled={
                      markPaidMutation.isPending ||
                      voidMutation.isPending ||
                      issueDocumentMutation.isPending ||
                      updateDocumentMutation.isPending
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="issued">Issued</option>
                    <option value="paid">Paid</option>
                    <option value="voided">Voided</option>
                  </select>
                </dd>
                <dt>Issue Date</dt>
                <dd>{formatDate(document.issueDate, locale)}</dd>
                {document.dueDate && (
                  <>
                    <dt>Due Date</dt>
                    <dd>{formatDate(document.dueDate, locale)}</dd>
                  </>
                )}
                {document.paidAt && (
                  <>
                    <dt>Paid At</dt>
                    <dd>{formatDate(document.paidAt, locale)}</dd>
                  </>
                )}
                <dt>Language</dt>
                <dd>{document.language === 'ar' ? 'Arabic' : 'English'}</dd>
                <dt>Template</dt>
                <dd style={{ textTransform: 'capitalize' }}>{document.templateId.replace('template', 'Template ')}</dd>
              </dl>
            </div>

            <div className="detail-card">
              <h3>Amounts</h3>
              <dl className="detail-list">
                <dt>Subtotal</dt>
                <dd>{formatAmount(document.subtotalMinor, document.currency, locale)}</dd>
                {document.discountMinor > 0 && (
                  <>
                    <dt>Discount</dt>
                    <dd>-{formatAmount(document.discountMinor, document.currency, locale)}</dd>
                  </>
                )}
                <dt>Tax ({(document.taxRate * 100).toFixed(0)}%)</dt>
                <dd>{formatAmount(document.taxMinor, document.currency, locale)}</dd>
                <dt>
                  <strong>Total</strong>
                </dt>
                <dd>
                  <strong>{formatAmount(document.totalMinor, document.currency, locale)}</strong>
                </dd>
              </dl>
            </div>

            {client && (
              <div className="detail-card">
                <h3>Client</h3>
                <dl className="detail-list">
                  <dt>Name</dt>
                  <dd>
                    <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                      {client.name}
                    </Link>
                  </dd>
                  {client.email && (
                    <>
                      <dt>Email</dt>
                      <dd>{client.email}</dd>
                    </>
                  )}
                  {client.phone && (
                    <>
                      <dt>Phone</dt>
                      <dd>{client.phone}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            {businessProfile && (
              <div className="detail-card">
                <h3>Business Profile</h3>
                <dl className="detail-list">
                  <dt>Name</dt>
                  <dd>{businessProfile.name}</dd>
                  {businessProfile.nameEn && (
                    <>
                      <dt>Name (English)</dt>
                      <dd>{businessProfile.nameEn}</dd>
                    </>
                  )}
                  {businessProfile.taxId && (
                    <>
                      <dt>Tax ID</dt>
                      <dd>{businessProfile.taxId}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            {document.items.length > 0 && (
              <div className="detail-card detail-card-wide">
                <h3>Line Items</h3>
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style={{ textAlign: 'end' }}>Qty</th>
                      <th style={{ textAlign: 'end' }}>Rate</th>
                      <th style={{ textAlign: 'end' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.name}</td>
                        <td style={{ textAlign: 'end' }}>{item.quantity}</td>
                        <td style={{ textAlign: 'end' }}>
                          {formatAmount(item.rateMinor, document.currency, locale)}
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          {formatAmount(
                            item.quantity * item.rateMinor - item.discountMinor,
                            document.currency,
                            locale
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {document.notes && (
              <div className="detail-card detail-card-wide">
                <h3>Notes</h3>
                <p className="detail-notes">{document.notes}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="detail-transactions">
            {document.linkedTransactionIds.length === 0 ? (
              <div className="empty-state">
                <p className="text-muted">No transactions linked to this document.</p>
              </div>
            ) : (
              <p className="text-muted">
                {document.linkedTransactionIds.length} transaction(s) linked.
                {/* TODO: Show linked transactions table */}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
