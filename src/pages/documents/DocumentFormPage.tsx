import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { PDFViewer } from '@react-pdf/renderer';
import { TopBar } from '../../components/layout';
import {
  useDocument,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  useClients,
  useBusinessProfiles,
  useDefaultBusinessProfile,
  useDocuments,
} from '../../hooks/useQueries';
import { cn, todayISO } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { DocumentPdf } from '../../features/documents/pdf';
import type {
  DocumentType,
  DocumentStatus,
  Currency,
  DocumentLanguage,
  PaymentMethod,
  DocumentItem,
  DocumentPayment,
} from '../../types';
import type { TemplateId } from '../../features/documents/pdf/styles';
import { nanoid } from 'nanoid';

// Document type options with labels
const DOCUMENT_TYPES: { value: DocumentType; label: string; labelAr: string }[] = [
  { value: 'invoice', label: 'Invoice', labelAr: 'فاتورة' },
  { value: 'receipt', label: 'Receipt', labelAr: 'إيصال' },
  { value: 'invoice_receipt', label: 'Invoice Receipt', labelAr: 'فاتورة وإيصال' },
  { value: 'credit_note', label: 'Credit Note', labelAr: 'إشعار دائن' },
  { value: 'price_offer', label: 'Price Offer', labelAr: 'عرض سعر' },
  { value: 'proforma_invoice', label: 'Proforma Invoice', labelAr: 'فاتورة مبدئية' },
  { value: 'donation_receipt', label: 'Donation Receipt', labelAr: 'إيصال تبرع' },
];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'other', label: 'Other' },
];

const TEMPLATES = [
  { value: 'template1', label: 'Classic' },
  { value: 'template2', label: 'Modern' },
  { value: 'template3', label: 'Minimal' },
];

// Schema for line items
const itemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  quantity: z.number().min(0.01, 'Quantity must be positive'),
  rateMinor: z.number().min(0, 'Rate must be non-negative'),
  discountMinor: z.number().min(0).default(0),
  taxExempt: z.boolean().default(false),
});

// Schema for payments
const paymentSchema = z.object({
  id: z.string(),
  amountMinor: z.number().min(0),
  currency: z.enum(['USD', 'ILS']),
  method: z.enum(['cash', 'bank_transfer', 'cheque', 'credit_card', 'other']),
  notes: z.string().optional(),
  paidAt: z.string(),
});

// Main form schema
const schema = z.object({
  type: z.enum([
    'invoice',
    'receipt',
    'invoice_receipt',
    'credit_note',
    'price_offer',
    'proforma_invoice',
    'donation_receipt',
  ]),
  number: z.string().optional(),
  businessProfileId: z.string().min(1, 'Business profile is required'),
  clientId: z.string().optional(),
  subject: z.string().optional(),
  brief: z.string().optional(),
  notes: z.string().optional(),
  currency: z.enum(['USD', 'ILS']),
  language: z.enum(['ar', 'en']),
  templateId: z.string(),
  issueDate: z.string().min(1, 'Issue date is required'),
  dueDate: z.string().optional(),
  taxRate: z.number().min(0).max(1),
  vatEnabled: z.boolean().default(true),
  items: z.array(itemSchema).min(1, 'At least one item is required'),
  payments: z.array(paymentSchema).optional(),
  refDocumentId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// Helper to calculate item totals
function calculateItemTotal(item: { quantity: number; rateMinor: number; discountMinor: number }) {
  return item.quantity * item.rateMinor - item.discountMinor;
}

// Helper to format minor amount to display
function formatMinorAmount(minor: number, currency: Currency): string {
  return (minor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });
}

export function DocumentFormPage() {
  const params = useParams({ strict: false }) as { documentId?: string };
  const documentId = params.documentId;
  const isEditMode = !!documentId;
  const navigate = useNavigate();
  const t = useT();

  const [showPreview, setShowPreview] = useState(false);
  const [isOriginal, setIsOriginal] = useState(true);

  // Query hooks
  const { data: existingDoc, isLoading: docLoading } = useDocument(documentId || '');
  const { data: clients = [] } = useClients();
  const { data: businessProfiles = [] } = useBusinessProfiles();
  const { data: defaultProfile } = useDefaultBusinessProfile();
  const { data: allDocuments = [] } = useDocuments({});

  // Mutations
  const createMutation = useCreateDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();

  // Get initial business profile ID
  const getInitialBusinessProfileId = () => {
    if (existingDoc) return existingDoc.businessProfileId;
    if (defaultProfile) return defaultProfile.id;
    if (businessProfiles.length > 0) return businessProfiles[0].id;
    return '';
  };

  const form = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      type: 'invoice',
      number: '',
      businessProfileId: getInitialBusinessProfileId(),
      clientId: '',
      subject: '',
      brief: '',
      notes: '',
      currency: 'USD',
      language: 'en',
      templateId: 'template1',
      issueDate: todayISO(),
      dueDate: '',
      taxRate: 0.18,
      vatEnabled: true,
      items: [{ name: '', quantity: 1, rateMinor: 0, discountMinor: 0, taxExempt: false }],
      payments: [],
      refDocumentId: '',
    },
  });

  const { watch, setValue, reset, control } = form;
  const selectedType = watch('type');
  const selectedCurrency = watch('currency');
  const taxRate = watch('taxRate');
  const vatEnabled = watch('vatEnabled');
  const watchedItems = watch('items');
  const watchedPayments = watch('payments') || [];
  const watchedBusinessProfileId = watch('businessProfileId');
  const watchedClientId = watch('clientId');
  const watchedLanguage = watch('language');
  const watchedTemplateId = watch('templateId');

  // Field arrays
  const {
    fields: itemFields,
    append: appendItem,
    remove: removeItem,
  } = useFieldArray({
    control,
    name: 'items',
  });

  const {
    fields: paymentFields,
    append: appendPayment,
    remove: removePayment,
  } = useFieldArray({
    control,
    name: 'payments',
  });

  // Calculate totals
  const watchedItemsJson = JSON.stringify(watchedItems);
  const totals = useMemo(() => {
    const items = watchedItems || [];
    const subtotal = items.reduce((sum, item) => {
      return sum + calculateItemTotal(item);
    }, 0);

    let tax = 0;
    if (vatEnabled) {
      const taxableAmount = items.reduce((sum, item) => {
        if (item.taxExempt) return sum;
        return sum + calculateItemTotal(item);
      }, 0);
      tax = Math.round(taxableAmount * taxRate);
    }

    const total = subtotal + tax;
    return { subtotal, tax, total };
  }, [watchedItemsJson, taxRate, vatEnabled]);

  // Total payments amount
  const totalPaidMinor = useMemo(() => {
    return watchedPayments.reduce((sum, p) => sum + (p.amountMinor || 0), 0);
  }, [watchedPayments]);

  // Reset form when existing document loads
  useEffect(() => {
    if (existingDoc) {
      reset({
        type: existingDoc.type,
        number: existingDoc.number,
        businessProfileId: existingDoc.businessProfileId,
        clientId: existingDoc.clientId || '',
        subject: existingDoc.subject || '',
        brief: existingDoc.brief || '',
        notes: existingDoc.notes || '',
        currency: existingDoc.currency,
        language: existingDoc.language,
        templateId: existingDoc.templateId,
        issueDate: existingDoc.issueDate.split('T')[0],
        dueDate: existingDoc.dueDate || '',
        taxRate: existingDoc.taxRate,
        vatEnabled: existingDoc.vatEnabled ?? true,
        items: existingDoc.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          rateMinor: item.rateMinor,
          discountMinor: item.discountMinor,
          taxExempt: item.taxExempt,
        })),
        payments: existingDoc.payments.map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor,
          currency: p.currency,
          method: p.method,
          notes: p.notes || '',
          paidAt: p.paidAt.split('T')[0],
        })),
        refDocumentId: existingDoc.refDocumentId || '',
      });
    }
  }, [existingDoc, reset]);

  // Update defaults when business profile changes
  useEffect(() => {
    const profileId = form.getValues('businessProfileId');
    const profile = businessProfiles.find((p) => p.id === profileId);
    if (profile && !isEditMode && !existingDoc) {
      setValue('currency', profile.defaultCurrency);
      setValue('language', profile.defaultLanguage);
    }
  }, [watchedBusinessProfileId, businessProfiles, isEditMode, existingDoc, setValue]);

  const onSubmit = async (data: FormData) => {
    const itemsWithVat: DocumentItem[] = data.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      rateMinor: item.rateMinor,
      rateVatMinor: item.taxExempt ? item.rateMinor : Math.round(item.rateMinor * (1 + data.taxRate)),
      discountMinor: item.discountMinor,
      taxExempt: item.taxExempt,
    }));

    const payments: DocumentPayment[] = (data.payments || []).map((p) => ({
      id: p.id,
      amountMinor: p.amountMinor,
      currency: p.currency,
      method: p.method,
      notes: p.notes,
      paidAt: new Date(p.paidAt).toISOString(),
    }));

    let status: DocumentStatus = 'draft';
    if (selectedType === 'receipt' || selectedType === 'invoice_receipt' || selectedType === 'donation_receipt') {
      status = 'paid';
    } else if (selectedType === 'price_offer' || selectedType === 'proforma_invoice') {
      status = 'issued';
    }

    const docData = {
      type: data.type,
      status,
      businessProfileId: data.businessProfileId,
      clientId: data.clientId || undefined,
      subject: data.subject || undefined,
      brief: data.brief || undefined,
      notes: data.notes || undefined,
      items: itemsWithVat,
      payments,
      subtotalMinor: totals.subtotal,
      discountMinor: 0,
      taxMinor: totals.tax,
      totalMinor: totals.total,
      taxRate: data.taxRate,
      vatEnabled: data.vatEnabled,
      currency: data.currency as Currency,
      language: data.language as DocumentLanguage,
      issueDate: new Date(data.issueDate).toISOString(),
      dueDate: data.dueDate ? data.dueDate : undefined,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      refDocumentId: data.refDocumentId || undefined,
      linkedTransactionIds: existingDoc?.linkedTransactionIds || [],
      templateId: data.templateId,
    };

    try {
      if (isEditMode && documentId) {
        const updateData = existingDoc?.status === 'draft' && data.number && data.number !== existingDoc.number
          ? { ...docData, number: data.number }
          : docData;
        await updateMutation.mutateAsync({ id: documentId, data: updateData });
        navigate({ to: '/documents/$documentId', params: { documentId } });
      } else {
        const result = await createMutation.mutateAsync(docData);
        navigate({ to: '/documents/$documentId', params: { documentId: result.id } });
      }
    } catch (error) {
      console.error('Failed to save document:', error);
    }
  };

  const handleDelete = async () => {
    if (!documentId) return;
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await deleteMutation.mutateAsync(documentId);
      navigate({ to: '/documents' });
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const addItem = () => {
    appendItem({ name: '', quantity: 1, rateMinor: 0, discountMinor: 0, taxExempt: false });
  };

  const addPayment = () => {
    appendPayment({
      id: nanoid(),
      amountMinor: totals.total - totalPaidMinor,
      currency: selectedCurrency,
      method: 'cash',
      notes: '',
      paidAt: todayISO(),
    });
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const showPayments =
    selectedType === 'receipt' || selectedType === 'invoice_receipt' || selectedType === 'donation_receipt';
  const showDueDate = selectedType === 'invoice' || selectedType === 'proforma_invoice';
  const showRefDocument = selectedType === 'credit_note';

  const referenceableDocuments = allDocuments.filter(
    (d) => d.status !== 'voided' && (d.type === 'invoice' || d.type === 'invoice_receipt')
  );

  // Get business profile and client for preview
  const selectedBusinessProfile = businessProfiles.find((p) => p.id === watchedBusinessProfileId);
  const selectedClient = clients.find((c) => c.id === watchedClientId);

  // Build preview document object
  const previewDocument = useMemo(() => ({
    id: documentId || 'preview',
    number: form.getValues('number') || 'PREVIEW',
    type: selectedType,
    status: 'draft' as DocumentStatus,
    businessProfileId: watchedBusinessProfileId,
    clientId: watchedClientId || undefined,
    subject: form.getValues('subject') || undefined,
    brief: form.getValues('brief') || undefined,
    notes: form.getValues('notes') || undefined,
    items: watchedItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      rateMinor: item.rateMinor,
      rateVatMinor: item.taxExempt ? item.rateMinor : Math.round(item.rateMinor * (1 + taxRate)),
      discountMinor: item.discountMinor,
      taxExempt: item.taxExempt,
    })),
    payments: [],
    subtotalMinor: totals.subtotal,
    discountMinor: 0,
    taxMinor: totals.tax,
    totalMinor: totals.total,
    taxRate: taxRate,
    vatEnabled: vatEnabled,
    currency: selectedCurrency,
    language: watchedLanguage,
    issueDate: new Date(form.getValues('issueDate') || todayISO()).toISOString(),
    dueDate: form.getValues('dueDate') || undefined,
    linkedTransactionIds: [],
    templateId: watchedTemplateId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [
    documentId,
    selectedType,
    watchedBusinessProfileId,
    watchedClientId,
    watchedItems,
    totals,
    taxRate,
    vatEnabled,
    selectedCurrency,
    watchedLanguage,
    watchedTemplateId,
  ]);

  if (isEditMode && docLoading) {
    return (
      <>
        <TopBar title={t('common.loading')} />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  // Guard: No business profiles
  if (businessProfiles.length === 0) {
    return (
      <>
        <TopBar
          title={isEditMode ? 'Edit Document' : 'New Document'}
          breadcrumbs={[
            { label: 'Documents', href: '/documents' },
            { label: isEditMode ? 'Edit' : 'New' },
          ]}
        />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('documentGuard.title')}</h3>
            <p className="empty-state-description">{t('documentGuard.description')}</p>
            <Link to="/settings" className="btn btn-primary">
              {t('documentGuard.createProfile')}
            </Link>
          </div>
        </div>
      </>
    );
  }

  const isReadOnly = isEditMode && existingDoc && existingDoc.status !== 'draft';

  return (
    <>
      <TopBar
        title={isEditMode ? `Edit ${existingDoc?.number || 'Document'}` : 'New Document'}
        breadcrumbs={[
          { label: 'Documents', href: '/documents' },
          { label: isEditMode ? 'Edit' : 'New' },
        ]}
      />
      <div className="page-content">
        <div className="document-form-page">
          {/* Header actions */}
          <div className="document-form-header">
            <div className="document-form-header-left">
              <Link to="/documents" className="btn btn-ghost">
                ← Back
              </Link>
              <button
                type="button"
                className={cn('btn', showPreview ? 'btn-secondary' : 'btn-ghost')}
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>
            <div className="document-form-header-right">
              {isEditMode && existingDoc?.status === 'draft' && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              )}
              <button
                type="submit"
                form="document-form"
                className="btn btn-primary"
                disabled={isSubmitting || isReadOnly}
              >
                {isSubmitting ? t('common.saving') : isEditMode ? 'Save Changes' : 'Create Document'}
              </button>
            </div>
          </div>

          {isReadOnly && (
            <div className="alert alert-info">
              This document is {existingDoc?.status} and cannot be edited.
            </div>
          )}

          <div className={cn('document-form-layout', showPreview && 'with-preview')}>
            {/* Form section */}
            <div className="document-form-main">
              <form id="document-form" onSubmit={form.handleSubmit(onSubmit)}>
                {/* Document Type Selector */}
                <div className="form-card">
                  <h3 className="form-card-title">Document Type</h3>
                  <div className="document-type-grid">
                    {DOCUMENT_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        className={cn('document-type-btn', selectedType === type.value && 'active')}
                        onClick={() => !isReadOnly && setValue('type', type.value)}
                        disabled={isReadOnly}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Document Number (only in edit mode) */}
                {isEditMode && existingDoc && (
                  <div className="form-card">
                    <h3 className="form-card-title">Document Number</h3>
                    <input
                      type="text"
                      className="input"
                      {...form.register('number')}
                      disabled={isReadOnly}
                      placeholder="e.g., INV-0001"
                    />
                    <p className="form-hint">
                      {isReadOnly
                        ? 'Document numbers can only be changed for draft documents.'
                        : 'You can manually change the document number. Must be unique.'}
                    </p>
                  </div>
                )}

                {/* Business & Client */}
                <div className="form-card">
                  <h3 className="form-card-title">Business & Client</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Business Profile *</label>
                      <Controller
                        name="businessProfileId"
                        control={control}
                        render={({ field }) => (
                          <select className="select" {...field} disabled={isReadOnly}>
                            <option value="">Select profile...</option>
                            {businessProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name} {profile.nameEn ? `(${profile.nameEn})` : ''}
                                {profile.isDefault ? ' - Default' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      />
                      {form.formState.errors.businessProfileId && (
                        <p className="form-error">{form.formState.errors.businessProfileId.message}</p>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Client</label>
                      <Controller
                        name="clientId"
                        control={control}
                        render={({ field }) => (
                          <select className="select" {...field} disabled={isReadOnly}>
                            <option value="">No client</option>
                            {clients.map((client) => (
                              <option key={client.id} value={client.id}>
                                {client.name}
                              </option>
                            ))}
                          </select>
                        )}
                      />
                    </div>
                  </div>

                  {/* Reference Document (for credit notes) */}
                  {showRefDocument && (
                    <div className="form-group">
                      <label className="form-label">Reference Document *</label>
                      <Controller
                        name="refDocumentId"
                        control={control}
                        render={({ field }) => (
                          <select className="select" {...field} disabled={isReadOnly}>
                            <option value="">Select original document...</option>
                            {referenceableDocuments.map((doc) => (
                              <option key={doc.id} value={doc.id}>
                                {doc.number} - {formatMinorAmount(doc.totalMinor, doc.currency)}
                              </option>
                            ))}
                          </select>
                        )}
                      />
                    </div>
                  )}
                </div>

                {/* Subject & Description */}
                <div className="form-card">
                  <h3 className="form-card-title">Subject & Description</h3>
                  <div className="form-group">
                    <label className="form-label">Subject</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Document subject..."
                      {...form.register('subject')}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Brief Description</label>
                    <textarea
                      className="textarea"
                      placeholder="Brief description..."
                      rows={2}
                      {...form.register('brief')}
                      disabled={isReadOnly}
                    />
                  </div>
                </div>

                {/* Settings */}
                <div className="form-card">
                  <h3 className="form-card-title">Settings</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Currency *</label>
                      <Controller
                        name="currency"
                        control={control}
                        render={({ field }) => (
                          <select className="select" {...field} disabled={isReadOnly}>
                            <option value="USD">USD ($)</option>
                            <option value="ILS">ILS (₪)</option>
                          </select>
                        )}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Language *</label>
                      <Controller
                        name="language"
                        control={control}
                        render={({ field }) => (
                          <select className="select" {...field} disabled={isReadOnly}>
                            <option value="en">English</option>
                            <option value="ar">Arabic</option>
                          </select>
                        )}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Template</label>
                      <Controller
                        name="templateId"
                        control={control}
                        render={({ field }) => (
                          <select className="select" {...field} disabled={isReadOnly}>
                            {TEMPLATES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        )}
                      />
                    </div>
                  </div>

                  {/* Dates & VAT Row */}
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Issue Date *</label>
                      <input
                        type="date"
                        className={cn('input', form.formState.errors.issueDate && 'input-error')}
                        {...form.register('issueDate')}
                        disabled={isReadOnly}
                      />
                    </div>
                    {showDueDate && (
                      <div className="form-group">
                        <label className="form-label">Due Date</label>
                        <input type="date" className="input" {...form.register('dueDate')} disabled={isReadOnly} />
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">VAT</label>
                      <div className="vat-toggle-row">
                        <Controller
                          name="vatEnabled"
                          control={control}
                          render={({ field }) => (
                            <label className="toggle-label">
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={(e) => {
                                  field.onChange(e.target.checked);
                                  if (e.target.checked && taxRate === 0) {
                                    setValue('taxRate', 0.18);
                                  }
                                }}
                                disabled={isReadOnly}
                              />
                              <span>Enable VAT</span>
                            </label>
                          )}
                        />
                        {vatEnabled && (
                          <Controller
                            name="taxRate"
                            control={control}
                            render={({ field }) => (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                className="input input-sm"
                                style={{ width: 80 }}
                                value={field.value * 100}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) / 100 || 0)}
                                disabled={isReadOnly}
                              />
                            )}
                          />
                        )}
                        {vatEnabled && <span className="text-muted">%</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Line Items Section */}
                <div className="form-card">
                  <div className="form-card-header">
                    <h3 className="form-card-title">Line Items</h3>
                    {!isReadOnly && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}>
                        + Add Item
                      </button>
                    )}
                  </div>

                  {itemFields.map((field, index) => (
                    <div key={field.id} className="line-item-row">
                      <div className="line-item-main">
                        <input
                          type="text"
                          className="input"
                          placeholder="Item name"
                          {...form.register(`items.${index}.name`)}
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="line-item-qty">
                        <Controller
                          name={`items.${index}.quantity`}
                          control={control}
                          render={({ field: f }) => (
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              className="input"
                              placeholder="Qty"
                              value={f.value}
                              onChange={(e) => f.onChange(parseFloat(e.target.value) || 0)}
                              disabled={isReadOnly}
                            />
                          )}
                        />
                      </div>
                      <div className="line-item-rate">
                        <Controller
                          name={`items.${index}.rateMinor`}
                          control={control}
                          render={({ field: f }) => (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="input"
                              placeholder="Rate"
                              value={f.value / 100}
                              onChange={(e) => f.onChange(Math.round(parseFloat(e.target.value) * 100) || 0)}
                              disabled={isReadOnly}
                            />
                          )}
                        />
                      </div>
                      <div className="line-item-total">
                        {formatMinorAmount(calculateItemTotal(watchedItems[index] || { quantity: 0, rateMinor: 0, discountMinor: 0 }), selectedCurrency)}
                      </div>
                      {!isReadOnly && itemFields.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          onClick={() => removeItem(index)}
                          title="Remove item"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {form.formState.errors.items && (
                    <p className="form-error">At least one item is required</p>
                  )}
                </div>

                {/* Totals Section */}
                <div className="form-card totals-card">
                  <div className="totals-section">
                    <div className="totals-row">
                      <span>Subtotal</span>
                      <span>{formatMinorAmount(totals.subtotal, selectedCurrency)}</span>
                    </div>
                    {vatEnabled && (
                      <div className="totals-row">
                        <span>VAT ({(taxRate * 100).toFixed(0)}%)</span>
                        <span>{formatMinorAmount(totals.tax, selectedCurrency)}</span>
                      </div>
                    )}
                    <div className="totals-row totals-total">
                      <span>Total</span>
                      <span>{formatMinorAmount(totals.total, selectedCurrency)}</span>
                    </div>
                  </div>
                </div>

                {/* Payments Section (for receipts) */}
                {showPayments && (
                  <div className="form-card">
                    <div className="form-card-header">
                      <h3 className="form-card-title">Payment Details</h3>
                      {!isReadOnly && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={addPayment}>
                          + Add Payment
                        </button>
                      )}
                    </div>

                    {paymentFields.map((field, index) => (
                      <div key={field.id} className="payment-row">
                        <div className="payment-method">
                          <Controller
                            name={`payments.${index}.method`}
                            control={control}
                            render={({ field: f }) => (
                              <select className="select" {...f} disabled={isReadOnly}>
                                {PAYMENT_METHODS.map((m) => (
                                  <option key={m.value} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          />
                        </div>
                        <div className="payment-amount">
                          <Controller
                            name={`payments.${index}.amountMinor`}
                            control={control}
                            render={({ field: f }) => (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="input"
                                placeholder="Amount"
                                value={(f.value ?? 0) / 100}
                                onChange={(e) => f.onChange(Math.round(parseFloat(e.target.value) * 100) || 0)}
                                disabled={isReadOnly}
                              />
                            )}
                          />
                        </div>
                        <div className="payment-date">
                          <input
                            type="date"
                            className="input"
                            {...form.register(`payments.${index}.paidAt`)}
                            disabled={isReadOnly}
                          />
                        </div>
                        {!isReadOnly && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => removePayment(index)}
                            title="Remove payment"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}

                    {paymentFields.length > 0 && (
                      <div className="totals-row" style={{ marginTop: 8 }}>
                        <span>Total Paid</span>
                        <span>{formatMinorAmount(totalPaidMinor, selectedCurrency)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Notes */}
                <div className="form-card">
                  <h3 className="form-card-title">Notes</h3>
                  <textarea
                    className="textarea"
                    placeholder="Additional notes (will appear on document)..."
                    rows={3}
                    {...form.register('notes')}
                    disabled={isReadOnly}
                  />
                </div>
              </form>
            </div>

            {/* Preview section */}
            {showPreview && selectedBusinessProfile && (
              <div className="document-form-preview">
                <div className="preview-header">
                  <h3>Preview</h3>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={isOriginal}
                      onChange={(e) => setIsOriginal(e.target.checked)}
                    />
                    <span>{isOriginal ? 'Original' : 'Copy'}</span>
                  </label>
                </div>
                <div className="preview-container">
                  <PDFViewer width="100%" height="100%" showToolbar={false}>
                    <DocumentPdf
                      document={previewDocument as any}
                      businessProfile={selectedBusinessProfile}
                      client={selectedClient || undefined}
                      templateId={watchedTemplateId as TemplateId}
                      isOriginal={isOriginal}
                    />
                  </PDFViewer>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
