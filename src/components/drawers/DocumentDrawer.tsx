import { useEffect, useMemo } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import {
  useDocument,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  useVoidDocument,
  useClients,
  useBusinessProfiles,
  useDefaultBusinessProfile,
  useDocuments,
} from '../../hooks/useQueries';
import { cn, todayISO } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type {
  DocumentType,
  DocumentStatus,
  Currency,
  DocumentLanguage,
  PaymentMethod,
  DocumentItem,
  DocumentPayment,
} from '../../types';
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
  currency: z.enum(['USD', 'ILS', 'EUR']),
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
  number: z.string().optional(), // Only used in edit mode for manual changes
  businessProfileId: z.string().min(1, 'Business profile is required'),
  clientId: z.string().optional(),
  subject: z.string().optional(),
  brief: z.string().optional(),
  notes: z.string().optional(),
  currency: z.enum(['USD', 'ILS', 'EUR']),
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

export function DocumentDrawer() {
  const { documentDrawer, closeDocumentDrawer } = useDrawerStore();
  const { mode, documentId, defaultType, defaultClientId, defaultBusinessProfileId, refDocumentId } =
    documentDrawer;
  const t = useT();

  // Query hooks
  const { data: existingDoc, isLoading: docLoading } = useDocument(documentId || '');
  const { data: clients = [] } = useClients();
  const { data: businessProfiles = [] } = useBusinessProfiles();
  const { data: defaultProfile } = useDefaultBusinessProfile();
  const { data: refDocument } = useDocument(refDocumentId || '');
  const { data: allDocuments = [] } = useDocuments({});

  // Mutations
  const createMutation = useCreateDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();
  const voidMutation = useVoidDocument();

  // Get initial business profile ID
  const getInitialBusinessProfileId = () => {
    if (existingDoc) return existingDoc.businessProfileId;
    if (defaultBusinessProfileId) return defaultBusinessProfileId;
    if (defaultProfile) return defaultProfile.id;
    if (businessProfiles.length > 0) return businessProfiles[0].id;
    return '';
  };

  const form = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      type: defaultType || 'invoice',
      number: '', // Auto-generated for new, editable for drafts
      businessProfileId: getInitialBusinessProfileId(),
      clientId: defaultClientId || '',
      subject: '',
      brief: '',
      notes: '',
      currency: 'USD',
      language: 'en',
      templateId: 'template1',
      issueDate: todayISO(),
      dueDate: '',
      taxRate: 0.18, // Default 18% VAT
      vatEnabled: true, // VAT enabled by default
      items: [{ name: '', quantity: 1, rateMinor: 0, discountMinor: 0, taxExempt: false }],
      payments: [],
      refDocumentId: refDocumentId || '',
    },
  });

  const { watch, setValue, reset, control } = form;
  const selectedType = watch('type');
  const selectedCurrency = watch('currency');
  const taxRate = watch('taxRate');
  const vatEnabled = watch('vatEnabled');
  const watchedItems = watch('items');
  const watchedPayments = watch('payments') || [];

  // Field arrays for items and payments
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

  // Calculate totals - use JSON.stringify to detect deep changes in items array
  const watchedItemsJson = JSON.stringify(watchedItems);
  const totals = useMemo(() => {
    const items = watchedItems || [];
    const subtotal = items.reduce((sum, item) => {
      return sum + calculateItemTotal(item);
    }, 0);

    // Only calculate tax if VAT is enabled
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
        vatEnabled: existingDoc.vatEnabled ?? true, // Default to true for old documents
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
    if (profile && mode === 'create' && !existingDoc) {
      setValue('currency', profile.defaultCurrency);
      setValue('language', profile.defaultLanguage);
    }
  }, [form.watch('businessProfileId'), businessProfiles, mode, existingDoc, setValue]);

  // Pre-fill from reference document (for credit notes)
  useEffect(() => {
    if (refDocument && mode === 'create' && selectedType === 'credit_note') {
      setValue('businessProfileId', refDocument.businessProfileId);
      setValue('clientId', refDocument.clientId || '');
      setValue('currency', refDocument.currency);
      setValue('language', refDocument.language);
      setValue('templateId', refDocument.templateId);
      setValue('taxRate', refDocument.taxRate);
      setValue(
        'items',
        refDocument.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          rateMinor: item.rateMinor,
          discountMinor: item.discountMinor,
          taxExempt: item.taxExempt,
        }))
      );
    }
  }, [refDocument, mode, selectedType, setValue]);

  const onSubmit = async (data: FormData) => {
    // Calculate VAT amounts for items
    const itemsWithVat: DocumentItem[] = data.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      rateMinor: item.rateMinor,
      rateVatMinor: item.taxExempt ? item.rateMinor : Math.round(item.rateMinor * (1 + data.taxRate)),
      discountMinor: item.discountMinor,
      taxExempt: item.taxExempt,
    }));

    // Map payments
    const payments: DocumentPayment[] = (data.payments || []).map((p) => ({
      id: p.id,
      amountMinor: p.amountMinor,
      currency: p.currency,
      method: p.method,
      notes: p.notes,
      paidAt: new Date(p.paidAt).toISOString(),
    }));

    // Determine status
    let status: DocumentStatus = 'draft';
    if (selectedType === 'receipt' || selectedType === 'invoice_receipt' || selectedType === 'donation_receipt') {
      // Receipt types start as paid
      status = 'paid';
    } else if (selectedType === 'price_offer' || selectedType === 'proforma_invoice') {
      // Offers/proforma start as issued
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
      discountMinor: 0, // Global discount not implemented yet
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
      exportCount: existingDoc?.exportCount || 0,
    };

    try {
      if (mode === 'edit' && documentId) {
        // Include number if it was changed (only for draft documents)
        const updateData = existingDoc?.status === 'draft' && data.number && data.number !== existingDoc.number
          ? { ...docData, number: data.number }
          : docData;
        await updateMutation.mutateAsync({ id: documentId, data: updateData });
      } else {
        await createMutation.mutateAsync(docData);
      }
      closeDocumentDrawer();
    } catch (error) {
      console.error('Failed to save document:', error);
    }
  };

  const handleDelete = async () => {
    if (!documentId) return;
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await deleteMutation.mutateAsync(documentId);
      closeDocumentDrawer();
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const handleVoid = async () => {
    if (!documentId) return;
    if (!confirm('Are you sure you want to void this document? This action cannot be undone.')) return;

    try {
      await voidMutation.mutateAsync(documentId);
      closeDocumentDrawer();
    } catch (error) {
      console.error('Failed to void document:', error);
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

  // Available documents for reference (only invoices/receipts that aren't voided)
  const referenceableDocuments = allDocuments.filter(
    (d) => d.status !== 'voided' && (d.type === 'invoice' || d.type === 'invoice_receipt')
  );

  if (mode === 'edit' && docLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeDocumentDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  // Guard: No business profiles exist
  if (businessProfiles.length === 0) {
    return (
      <Drawer title={mode === 'edit' ? 'Edit Document' : 'New Document'} onClose={closeDocumentDrawer}>
        <div className="document-guard">
          <div className="document-guard-icon">
            <BusinessIcon />
          </div>
          <h3 className="document-guard-title">{t('documentGuard.title')}</h3>
          <p className="document-guard-description">{t('documentGuard.description')}</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              closeDocumentDrawer();
              const { openBusinessProfileDrawer } = useDrawerStore.getState();
              openBusinessProfileDrawer({ mode: 'create' });
            }}
          >
            {t('documentGuard.createProfile')}
          </button>
        </div>
      </Drawer>
    );
  }

  // Can only edit drafts
  const isReadOnly = mode === 'edit' && existingDoc && existingDoc.status !== 'draft';

  return (
    <Drawer
      title={mode === 'edit' ? 'Edit Document' : 'New Document'}
      onClose={closeDocumentDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && existingDoc?.status === 'draft' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {t('common.delete')}
              </button>
            )}
            {mode === 'edit' && existingDoc?.status === 'issued' && (
              <button
                type="button"
                className="btn btn-warning"
                onClick={handleVoid}
                disabled={voidMutation.isPending}
              >
                Void Document
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeDocumentDrawer}>
              {t('common.cancel')}
            </button>
            {!isReadOnly && (
              <button
                type="submit"
                form="document-form"
                className="btn btn-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('common.saving') : t('common.save')}
              </button>
            )}
          </div>
        </>
      }
    >
      <form id="document-form" onSubmit={form.handleSubmit(onSubmit)}>
        {isReadOnly && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            This document is {existingDoc?.status} and cannot be edited.
          </div>
        )}

        {/* Document Type Selector */}
        <div className="form-group">
          <label className="form-label">Document Type *</label>
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
        {mode === 'edit' && existingDoc && (
          <div className="form-group">
            <label className="form-label">Document Number</label>
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

        {/* Business Profile & Client Row */}
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

        {/* Subject */}
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

        {/* Brief */}
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

        {/* Settings Row */}
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

        {/* Dates Row */}
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
                        // When enabling VAT, set default rate of 18%
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

        {/* Line Items Section */}
        <div className="form-section">
          <div className="form-section-header">
            <h3 className="form-section-title">Line Items</h3>
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

        {/* Payments Section (for receipts) */}
        {showPayments && (
          <div className="form-section">
            <div className="form-section-header">
              <h3 className="form-section-title">Payment Details</h3>
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
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="textarea"
            placeholder="Additional notes (will appear on document)..."
            rows={3}
            {...form.register('notes')}
            disabled={isReadOnly}
          />
        </div>
      </form>
    </Drawer>
  );
}

function BusinessIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z"
      />
    </svg>
  );
}
