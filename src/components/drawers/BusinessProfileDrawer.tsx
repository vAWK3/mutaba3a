import { useEffect, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import {
  useBusinessProfile,
  useCreateBusinessProfile,
  useUpdateBusinessProfile,
  useArchiveBusinessProfile,
} from '../../hooks/useQueries';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { BusinessType, Currency, DocumentLanguage } from '../../types';

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
});

type FormData = z.infer<typeof schema>;

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'none', label: 'Individual / Freelancer' },
  { value: 'exempt', label: 'Exempt Dealer' },
  { value: 'authorized', label: 'Authorized Dealer' },
  { value: 'company', label: 'Company / Corporation' },
  { value: 'lawyer', label: 'Lawyer / Law Firm' },
];

export function BusinessProfileDrawer() {
  const { businessProfileDrawer, closeBusinessProfileDrawer } = useDrawerStore();
  const { mode, profileId } = businessProfileDrawer;
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: existingProfile, isLoading: profileLoading } = useBusinessProfile(profileId || '');
  const createMutation = useCreateBusinessProfile();
  const updateMutation = useUpdateBusinessProfile();
  const archiveMutation = useArchiveBusinessProfile();

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
    },
  });

  // Reset form when existing profile loads
  useEffect(() => {
    if (existingProfile) {
      form.reset({
        name: existingProfile.name,
        nameEn: existingProfile.nameEn || '',
        email: existingProfile.email,
        phone: existingProfile.phone || '',
        taxId: existingProfile.taxId || '',
        businessType: existingProfile.businessType,
        address1: existingProfile.address1 || '',
        address1En: existingProfile.address1En || '',
        city: existingProfile.city || '',
        cityEn: existingProfile.cityEn || '',
        country: existingProfile.country || '',
        countryEn: existingProfile.countryEn || '',
        postalCode: existingProfile.postalCode || '',
        primaryColor: existingProfile.primaryColor || '#3b82f6',
        defaultCurrency: existingProfile.defaultCurrency,
        defaultLanguage: existingProfile.defaultLanguage,
        isDefault: existingProfile.isDefault,
      });
      if (existingProfile.logoDataUrl) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLogoPreview(existingProfile.logoDataUrl);
      }
    }
  }, [existingProfile, form]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert to base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setLogoPreview(base64);
    };
    reader.readAsDataURL(file);
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
    };

    try {
      if (mode === 'edit' && profileId) {
        await updateMutation.mutateAsync({ id: profileId, data: profileData });
      } else {
        await createMutation.mutateAsync(profileData);
      }
      closeBusinessProfileDrawer();
    } catch (error) {
      console.error('Failed to save business profile:', error);
    }
  };

  const handleArchive = async () => {
    if (!profileId) return;
    if (!confirm('Are you sure you want to archive this business profile?')) return;

    try {
      await archiveMutation.mutateAsync(profileId);
      closeBusinessProfileDrawer();
    } catch (error) {
      console.error('Failed to archive profile:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && profileLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeBusinessProfileDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? 'Edit Business Profile' : 'New Business Profile'}
      onClose={closeBusinessProfileDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && !existingProfile?.isDefault && (
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
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeBusinessProfileDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="business-profile-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="business-profile-form" onSubmit={form.handleSubmit(onSubmit)}>
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

        {/* Defaults */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Default Currency</label>
            <select className="select" {...form.register('defaultCurrency')}>
              <option value="USD">USD ($)</option>
              <option value="ILS">ILS (₪)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Default Language</label>
            <select className="select" {...form.register('defaultLanguage')}>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
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
      </form>
    </Drawer>
  );
}
