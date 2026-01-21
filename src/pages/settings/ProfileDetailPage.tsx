import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TopBar } from '../../components/layout';
import {
  useBusinessProfile,
  useUpdateBusinessProfile,
  useArchiveBusinessProfile,
  useDocumentSequences,
  useUpdateDocumentSequence,
} from '../../hooks/useQueries';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import type { BusinessType, Currency, DocumentLanguage, DocumentType, DocumentSequence, TemplateId } from '../../types';

// Form validation schema
const schema = z.object({
  name: z.string().min(1, 'Business name is required'),
  nameEn: z.string().optional(),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  businessType: z.enum(['exempt', 'authorized', 'company', 'lawyer', 'none']),
  address1: z.string().optional(),
  address1En: z.string().optional(),
  city: z.string().optional(),
  cityEn: z.string().optional(),
  country: z.string().optional(),
  countryEn: z.string().optional(),
  postalCode: z.string().optional(),
  primaryColor: z.string().optional(),
  defaultCurrency: z.enum(['USD', 'ILS', 'EUR']),
  defaultLanguage: z.enum(['ar', 'en']),
  isDefault: z.boolean(),
  // Document defaults
  website: z.string().optional(),
  defaultTemplateId: z.enum(['template1', 'template2', 'template3']).optional(),
  defaultTaxRate: z.number().min(0).max(1).optional(),
  allowedCurrencies: z.array(z.enum(['USD', 'ILS', 'EUR'])).optional(),
  // Payment/Bank details
  bankName: z.string().optional(),
  bankBranch: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIban: z.string().optional(),
  paymentNotes: z.string().optional(),
});

const TEMPLATES = [
  { value: 'template1', label: 'Classic' },
  { value: 'template2', label: 'Modern' },
  { value: 'template3', label: 'Minimal' },
];

type FormData = z.infer<typeof schema>;

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'none', label: 'Individual / Freelancer' },
  { value: 'exempt', label: 'Exempt Dealer' },
  { value: 'authorized', label: 'Authorized Dealer' },
  { value: 'company', label: 'Company / Corporation' },
  { value: 'lawyer', label: 'Lawyer / Law Firm' },
];

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  invoice_receipt: 'Invoice Receipt',
  credit_note: 'Credit Note',
  price_offer: 'Price Offer',
  proforma_invoice: 'Proforma Invoice',
  donation_receipt: 'Donation Receipt',
};

const DEFAULT_PREFIXES: Record<DocumentType, string> = {
  invoice: 'INV',
  receipt: 'REC',
  invoice_receipt: 'IR',
  credit_note: 'CN',
  price_offer: 'PO',
  proforma_invoice: 'PI',
  donation_receipt: 'DR',
};

const ALL_DOCUMENT_TYPES: DocumentType[] = [
  'invoice',
  'receipt',
  'invoice_receipt',
  'credit_note',
  'price_offer',
  'proforma_invoice',
  'donation_receipt',
];

export function ProfileDetailPage() {
  const { profileId } = useParams({ from: '/settings/profiles/$profileId' });
  const navigate = useNavigate();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'info' | 'numbering' | 'currency' | 'payment'>('info');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: profile, isLoading: profileLoading } = useBusinessProfile(profileId);
  const updateMutation = useUpdateBusinessProfile();
  const archiveMutation = useArchiveBusinessProfile();
  const { data: sequences = [] } = useDocumentSequences(profileId);
  const updateSequenceMutation = useUpdateDocumentSequence();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      nameEn: '',
      email: '',
      phone: '',
      taxId: '',
      businessType: 'none',
      address1: '',
      address1En: '',
      city: '',
      cityEn: '',
      country: '',
      countryEn: '',
      postalCode: '',
      primaryColor: '#3b82f6',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      isDefault: false,
      // Document defaults
      website: '',
      defaultTemplateId: 'template1',
      defaultTaxRate: 0.17,
      allowedCurrencies: ['USD', 'ILS'],
      // Payment/Bank details
      bankName: '',
      bankBranch: '',
      bankAccountNumber: '',
      bankIban: '',
      paymentNotes: '',
    },
  });

  // Reset form when profile loads
  useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name,
        nameEn: profile.nameEn || '',
        email: profile.email,
        phone: profile.phone || '',
        taxId: profile.taxId || '',
        businessType: profile.businessType,
        address1: profile.address1 || '',
        address1En: profile.address1En || '',
        city: profile.city || '',
        cityEn: profile.cityEn || '',
        country: profile.country || '',
        countryEn: profile.countryEn || '',
        postalCode: profile.postalCode || '',
        primaryColor: profile.primaryColor || '#3b82f6',
        defaultCurrency: profile.defaultCurrency,
        defaultLanguage: profile.defaultLanguage,
        isDefault: profile.isDefault,
        // Document defaults
        website: profile.website || '',
        defaultTemplateId: profile.defaultTemplateId || 'template1',
        defaultTaxRate: profile.defaultTaxRate ?? 0.17,
        allowedCurrencies: profile.allowedCurrencies || ['USD', 'ILS'],
        // Payment/Bank details
        bankName: profile.bankName || '',
        bankBranch: profile.bankBranch || '',
        bankAccountNumber: profile.bankAccountNumber || '',
        bankIban: profile.bankIban || '',
        paymentNotes: profile.paymentNotes || '',
      });
      if (profile.logoDataUrl) {
        setLogoPreview(profile.logoDataUrl);
      }
    }
  }, [profile, form]);

  // Build a map of sequences by document type for easy access
  const sequenceMap = sequences.reduce((acc, seq) => {
    acc[seq.documentType] = seq;
    return acc;
  }, {} as Record<DocumentType, DocumentSequence>);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setLogoPreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleSequenceUpdate = (
    documentType: DocumentType,
    field: 'prefix' | 'prefixEnabled' | 'lastNumber',
    value: string | boolean | number
  ) => {
    const updates: Partial<DocumentSequence> = {};
    if (field === 'prefix') {
      updates.prefix = value as string;
    } else if (field === 'prefixEnabled') {
      updates.prefixEnabled = value as boolean;
    } else if (field === 'lastNumber') {
      updates.lastNumber = Math.max(0, (value as number) - 1);
    }

    updateSequenceMutation.mutate({
      businessProfileId: profileId,
      documentType,
      updates,
    });
  };

  const onSubmit = async (data: FormData) => {
    const profileData = {
      name: data.name,
      nameEn: data.nameEn || undefined,
      email: data.email,
      phone: data.phone || undefined,
      taxId: data.taxId || undefined,
      businessType: data.businessType as BusinessType,
      address1: data.address1 || undefined,
      address1En: data.address1En || undefined,
      city: data.city || undefined,
      cityEn: data.cityEn || undefined,
      country: data.country || undefined,
      countryEn: data.countryEn || undefined,
      postalCode: data.postalCode || undefined,
      logoDataUrl: logoPreview || undefined,
      primaryColor: data.primaryColor || undefined,
      defaultCurrency: data.defaultCurrency as Currency,
      defaultLanguage: data.defaultLanguage as DocumentLanguage,
      isDefault: data.isDefault,
      // Document defaults
      website: data.website || undefined,
      defaultTemplateId: data.defaultTemplateId as TemplateId || undefined,
      defaultTaxRate: data.defaultTaxRate,
      allowedCurrencies: data.allowedCurrencies as Currency[] || undefined,
      // Payment/Bank details
      bankName: data.bankName || undefined,
      bankBranch: data.bankBranch || undefined,
      bankAccountNumber: data.bankAccountNumber || undefined,
      bankIban: data.bankIban || undefined,
      paymentNotes: data.paymentNotes || undefined,
    };

    try {
      await updateMutation.mutateAsync({ id: profileId, data: profileData });
    } catch (error) {
      console.error('Failed to save business profile:', error);
    }
  };

  const handleArchive = async () => {
    if (!confirm('Are you sure you want to archive this business profile?')) return;

    try {
      await archiveMutation.mutateAsync(profileId);
      navigate({ to: '/settings' });
    } catch (error) {
      console.error('Failed to archive profile:', error);
    }
  };

  const isSubmitting = updateMutation.isPending;

  if (profileLoading) {
    return (
      <>
        <TopBar
          title={t('common.loading')}
          breadcrumbs={[
            { label: t('nav.settings'), href: '/settings' },
            { label: 'Profiles' },
          ]}
          hideAddMenu
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
          title="Profile Not Found"
          breadcrumbs={[
            { label: t('nav.settings'), href: '/settings' },
            { label: 'Profiles' },
          ]}
          hideAddMenu
        />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">Profile not found</h3>
            <p className="empty-state-description">This profile may have been archived or deleted.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={profile.name}
        breadcrumbs={[
          { label: t('nav.settings'), href: '/settings' },
          { label: 'Profiles' },
          { label: profile.name },
        ]}
        hideAddMenu
      />
      <div className="page-content" style={{ maxWidth: 700 }}>
        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 24 }}>
          <div className="tabs-list">
            <button
              className={cn('tab', activeTab === 'info' && 'active')}
              onClick={() => setActiveTab('info')}
            >
              Profile Info
            </button>
            <button
              className={cn('tab', activeTab === 'numbering' && 'active')}
              onClick={() => setActiveTab('numbering')}
            >
              Document Numbering
            </button>
            <button
              className={cn('tab', activeTab === 'currency' && 'active')}
              onClick={() => setActiveTab('currency')}
            >
              Document Defaults
            </button>
            <button
              className={cn('tab', activeTab === 'payment' && 'active')}
              onClick={() => setActiveTab('payment')}
            >
              Payment Details
            </button>
          </div>
        </div>

        {activeTab === 'info' && (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Logo */}
            <div className="form-group">
              <label className="form-label">Logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 4 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      backgroundColor: 'var(--color-bg-secondary)',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--color-text-tertiary)',
                      fontSize: 12,
                    }}
                  >
                    No logo
                  </div>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  {logoPreview ? 'Change' : 'Upload'}
                </button>
                {logoPreview && (
                  <button type="button" className="btn btn-ghost" onClick={() => setLogoPreview(null)}>
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* Business Name */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Business Name (Arabic) *</label>
                <input
                  type="text"
                  className={cn('input', form.formState.errors.name && 'input-error')}
                  placeholder="اسم الشركة"
                  dir="rtl"
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="form-error">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Business Name (English)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Company Name"
                  {...form.register('nameEn')}
                />
              </div>
            </div>

            {/* Contact */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input
                  type="email"
                  className={cn('input', form.formState.errors.email && 'input-error')}
                  placeholder="email@example.com"
                  {...form.register('email')}
                />
                {form.formState.errors.email && (
                  <p className="form-error">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="+972 50 000 0000"
                  {...form.register('phone')}
                />
              </div>
            </div>

            {/* Business Type & Tax ID */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Business Type</label>
                <select className="select" {...form.register('businessType')}>
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Tax ID</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Tax/VAT Number"
                  {...form.register('taxId')}
                />
              </div>
            </div>

            {/* Address */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Address (Arabic)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="العنوان"
                  dir="rtl"
                  {...form.register('address1')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Address (English)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="123 Main St"
                  {...form.register('address1En')}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">City (Arabic)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="المدينة"
                  dir="rtl"
                  {...form.register('city')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">City (English)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="City"
                  {...form.register('cityEn')}
                />
              </div>
            </div>

            {/* Brand Color */}
            <div className="form-group">
              <label className="form-label">Brand Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="color"
                  style={{ width: 40, height: 32, padding: 0, border: 'none', cursor: 'pointer' }}
                  {...form.register('primaryColor')}
                />
                <input
                  type="text"
                  className="input"
                  style={{ width: 120 }}
                  placeholder="#3b82f6"
                  {...form.register('primaryColor')}
                />
              </div>
            </div>

            {/* Default Profile */}
            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" {...form.register('isDefault')} />
                <span>Set as default profile</span>
              </label>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div>
                {!profile.isDefault && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={handleArchive}
                    disabled={archiveMutation.isPending}
                  >
                    {t('common.archive')}
                  </button>
                )}
              </div>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'numbering' && (
          <div>
            <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
              Configure how document numbers are generated for each type. These settings apply to this business profile only.
            </p>

            <table className="settings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Type</th>
                  <th style={{ textAlign: 'start', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Prefix</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Use Prefix</th>
                  <th style={{ textAlign: 'end', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Next #</th>
                </tr>
              </thead>
              <tbody>
                {ALL_DOCUMENT_TYPES.map((type) => {
                  const seq = sequenceMap[type];
                  const prefix = seq?.prefix || DEFAULT_PREFIXES[type];
                  const prefixEnabled = seq?.prefixEnabled ?? true;
                  const nextNumber = (seq?.lastNumber || 0) + 1;

                  return (
                    <tr key={type}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                        {DOCUMENT_TYPE_LABELS[type]}
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                        <input
                          type="text"
                          className="input input-sm"
                          style={{ width: 80 }}
                          value={prefix}
                          onChange={(e) => handleSequenceUpdate(type, 'prefix', e.target.value)}
                          placeholder={DEFAULT_PREFIXES[type]}
                          disabled={!prefixEnabled}
                        />
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={prefixEnabled}
                          onChange={(e) => handleSequenceUpdate(type, 'prefixEnabled', e.target.checked)}
                        />
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', textAlign: 'end' }}>
                        <input
                          type="number"
                          className="input input-sm"
                          style={{ width: 80, textAlign: 'end' }}
                          min={1}
                          value={nextNumber}
                          onChange={(e) => handleSequenceUpdate(type, 'lastNumber', parseInt(e.target.value) || 1)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="text-muted text-sm" style={{ marginTop: 12 }}>
              Example: {sequenceMap['invoice']?.prefixEnabled !== false
                ? `${sequenceMap['invoice']?.prefix || 'INV'}-${String((sequenceMap['invoice']?.lastNumber || 0) + 1).padStart(4, '0')}`
                : String((sequenceMap['invoice']?.lastNumber || 0) + 1).padStart(4, '0')}
            </p>
          </div>
        )}

        {activeTab === 'currency' && (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <p className="text-muted text-sm" style={{ marginBottom: 24 }}>
              Configure default settings for documents created with this profile.
            </p>

            <div className="settings-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="settings-label">Default Currency</div>
                <div className="settings-description">Currency used by default for new documents</div>
              </div>
              <select className="select" {...form.register('defaultCurrency')}>
                <option value="USD">USD ($)</option>
                <option value="ILS">ILS (&#8362;)</option>
              </select>
            </div>

            <div className="settings-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="settings-label">Default Language</div>
                <div className="settings-description">Language used by default for document content</div>
              </div>
              <select className="select" {...form.register('defaultLanguage')}>
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </select>
            </div>

            <div className="settings-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="settings-label">Default Template</div>
                <div className="settings-description">PDF template style for documents</div>
              </div>
              <select className="select" {...form.register('defaultTemplateId')}>
                {TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="settings-label">Default Tax Rate</div>
                <div className="settings-description">VAT rate for new documents (e.g., 17%)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  className="input input-sm"
                  style={{ width: 80, textAlign: 'right' }}
                  step="0.01"
                  min="0"
                  max="100"
                  value={(form.watch('defaultTaxRate') ?? 0.17) * 100}
                  onChange={(e) => form.setValue('defaultTaxRate', parseFloat(e.target.value) / 100 || 0)}
                />
                <span className="text-muted">%</span>
              </div>
            </div>

            <div className="settings-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="settings-label">Website</div>
                <div className="settings-description">Website URL shown on documents</div>
              </div>
              <input
                type="url"
                className="input"
                style={{ width: 200 }}
                placeholder="https://example.com"
                {...form.register('website')}
              />
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-label">Allowed Currencies</div>
                <div className="settings-description">Currencies available when creating documents</div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.watch('allowedCurrencies')?.includes('USD') ?? true}
                    onChange={(e) => {
                      const current = form.getValues('allowedCurrencies') || ['USD', 'ILS'];
                      if (e.target.checked) {
                        form.setValue('allowedCurrencies', [...new Set([...current, 'USD' as Currency])]);
                      } else {
                        form.setValue('allowedCurrencies', current.filter((c) => c !== 'USD'));
                      }
                    }}
                  />
                  <span>USD ($)</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.watch('allowedCurrencies')?.includes('ILS') ?? true}
                    onChange={(e) => {
                      const current = form.getValues('allowedCurrencies') || ['USD', 'ILS'];
                      if (e.target.checked) {
                        form.setValue('allowedCurrencies', [...new Set([...current, 'ILS' as Currency])]);
                      } else {
                        form.setValue('allowedCurrencies', current.filter((c) => c !== 'ILS'));
                      }
                    }}
                  />
                  <span>ILS (&#8362;)</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)', textAlign: 'end' }}>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'payment' && (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <p className="text-muted text-sm" style={{ marginBottom: 24 }}>
              Bank and payment details to display on invoices and other documents.
            </p>

            <div className="form-row" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">Bank Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Bank of Example"
                  {...form.register('bankName')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Branch</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Main Branch"
                  {...form.register('bankBranch')}
                />
              </div>
            </div>

            <div className="form-row" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">Account Number</label>
                <input
                  type="text"
                  className="input"
                  placeholder="12345678"
                  {...form.register('bankAccountNumber')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">IBAN</label>
                <input
                  type="text"
                  className="input"
                  placeholder="IL12 3456 7890 1234 5678 901"
                  {...form.register('bankIban')}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Payment Notes</label>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Additional payment instructions (e.g., payment terms, wire transfer details)..."
                {...form.register('paymentNotes')}
              />
              <p className="text-muted text-sm" style={{ marginTop: 4 }}>
                These notes will appear in the footer of invoices.
              </p>
            </div>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)', textAlign: 'end' }}>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
