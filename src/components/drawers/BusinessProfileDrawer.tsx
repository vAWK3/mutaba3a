import { useEffect, useId, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { Select } from '../ui';
import { useDrawerStore } from '../../lib/stores';
import {
  useBusinessProfile,
  useCreateBusinessProfile,
  useUpdateBusinessProfile,
  useArchiveBusinessProfile,
} from '../../hooks/useQueries';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { Currency } from '../../types';

const schema = z.object({
  name: z.string().min(1, 'Business name is required'),
  nameEn: z.string().optional(),
  // Optional since MUT-145: only an invoice letterhead needed it.
  email: z.union([z.literal(''), z.string().email('Invalid email')]).optional(),
  phone: z.string().optional(),
  primaryColor: z.string().optional(),
  defaultCurrency: z.enum(['USD', 'ILS', 'EUR']),
  isDefault: z.boolean(),
});

type FormData = z.infer<typeof schema>;

export function BusinessProfileDrawer() {
  const { businessProfileDrawer, closeBusinessProfileDrawer } = useDrawerStore();
  const { mode, profileId } = businessProfileDrawer;
  const t = useT();
  const fieldId = useId();
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
      primaryColor: '#3b82f6',
      defaultCurrency: 'USD',
      isDefault: false,
    },
  });

  // Reset form when existing profile loads
  useEffect(() => {
    if (existingProfile) {
      form.reset({
        name: existingProfile.name,
        nameEn: existingProfile.nameEn || '',
        email: existingProfile.email || '',
        phone: existingProfile.phone || '',
        primaryColor: existingProfile.primaryColor || '#3b82f6',
        // Stays USD/ILS/EUR-only (MUT-140 scope: JOD not added to profile-default currency).
        defaultCurrency: existingProfile.defaultCurrency as 'USD' | 'ILS' | 'EUR',
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
      email: data.email || undefined,
      phone: data.phone || undefined,
      logoDataUrl: logoPreview || undefined,
      primaryColor: data.primaryColor || undefined,
      defaultCurrency: data.defaultCurrency as Currency,
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
      <form id="business-profile-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {/* Identity: who this business is (MUT-145 IA) */}
        <section className="profile-drawer-section" aria-labelledby={`${fieldId}-identity`}>
          <h3 className="profile-drawer-section-title" id={`${fieldId}-identity`}>
            {t('drawer.businessProfile.sectionIdentity')}
          </h3>

          <div className="form-group">
            <span className="form-label">Logo</span>
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

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor={`${fieldId}-name`}>Business Name (Arabic) *</label>
              <input
                id={`${fieldId}-name`}
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
              <label className="form-label" htmlFor={`${fieldId}-nameEn`}>Business Name (English)</label>
              <input
                id={`${fieldId}-nameEn`}
                type="text"
                className="input"
                placeholder="Company Name"
                {...form.register('nameEn')}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`${fieldId}-color`}>Brand Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                id={`${fieldId}-color`}
                type="color"
                style={{ width: 40, height: 32, padding: 0, border: 'none', cursor: 'pointer' }}
                {...form.register('primaryColor')}
              />
              <input
                type="text"
                className="input"
                style={{ width: 120 }}
                placeholder="#3b82f6"
                aria-label="Brand Color hex"
                {...form.register('primaryColor')}
              />
            </div>
          </div>
        </section>

        {/* Money: the default currency for new income entries */}
        <section className="profile-drawer-section" aria-labelledby={`${fieldId}-money`}>
          <h3 className="profile-drawer-section-title" id={`${fieldId}-money`}>
            {t('drawer.businessProfile.sectionMoney')}
          </h3>
          <div className="form-group">
            <label className="form-label" htmlFor={`${fieldId}-currency`}>
              {t('drawer.businessProfile.defaultCurrency')}
            </label>
            <Select id={`${fieldId}-currency`} {...form.register('defaultCurrency')}>
              <option value="USD">USD ($)</option>
              <option value="ILS">ILS (₪)</option>
            </Select>
            <p className="form-hint">{t('drawer.businessProfile.defaultCurrencyHint')}</p>
          </div>
        </section>

        {/* Contact: optional */}
        <section className="profile-drawer-section" aria-labelledby={`${fieldId}-contact`}>
          <h3 className="profile-drawer-section-title" id={`${fieldId}-contact`}>
            {t('drawer.businessProfile.sectionContact')}
          </h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor={`${fieldId}-email`}>Email</label>
              <input
                id={`${fieldId}-email`}
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
              <label className="form-label" htmlFor={`${fieldId}-phone`}>Phone</label>
              <input
                id={`${fieldId}-phone`}
                type="tel"
                className="input"
                placeholder="+972 50 000 0000"
                {...form.register('phone')}
              />
            </div>
          </div>
        </section>

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
