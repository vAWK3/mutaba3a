import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { useT } from '../../lib/i18n/core';
import type { CreateProfileRequest, HostedProfile } from '../api/client';
import { canCreateProfile } from '../data/profileRules';
import { useCreateProfile, useProfileCreateAttempt } from '../data/profileQueries';
import { HOSTED_CURRENCIES } from '../format/currencies';
import { browserTimezone, timezoneOptions } from '../format/timezones';
import { ME_KEY, useMe } from '../session/me';
import { Drawer } from './Drawer';
import { ProfileBanner } from './ProfileBanner';
import { ProfileTypeCards } from './ProfileTypeCards';
import { mapProfileError, type ProfileBanner as Banner } from './profileApiErrors';
import { createProfileSchema, type CreateProfileFormValues } from './profileFormSchema';
import { useToast } from './Toast';

/**
 * New profile (MUT-183 plan §2.3): name, type, currency and time zone, in a
 * drawer, never a page. The zone is a fact row from the browser until the user
 * asks to change it (design review Issue 10). On success the new profile is
 * written into `me` and opened at once (eng review R2).
 */

const FORM_ID = 'hosted-profile-create-form';
const DEFAULT_CURRENCY = 'ILS';

export interface ProfileCreateDrawerProps {
  /** The profile the user is in, for the default currency; null on the empty state. */
  active: HostedProfile | null;
  onClose: () => void;
}

export function ProfileCreateDrawer({ active, onClose }: ProfileCreateDrawerProps) {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const create = useCreateProfile();
  const attempt = useProfileCreateAttempt();
  const [banner, setBanner] = useState<Banner | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const zoneRef = useRef<HTMLSelectElement | null>(null);
  // Synchronous: two quick clicks both pass validation before the mutation reports pending (CR9).
  const submitting = useRef(false);

  const zone = useMemo(browserTimezone, []);
  const zones = useMemo(() => timezoneOptions(zone), [zone]);
  const atCap = capReached || !canCreateProfile(me);
  const capBanner: Banner = { tone: 'info', key: 'hosted.profiles.errors.limit', count: me.limits.maxOwnedProfiles };

  const form = useForm<CreateProfileFormValues>({
    resolver: zodResolver(createProfileSchema) as never,
    defaultValues: {
      name: '',
      type: '',
      defaultCurrency: active && (HOSTED_CURRENCIES as readonly string[]).includes(active.defaultCurrency) ? active.defaultCurrency : DEFAULT_CURRENCY,
      timezone: zone,
    },
  });
  const { control, handleSubmit, setError, formState, register } = form;

  const revealZone = () => {
    setZoneOpen(true);
    // The select mounts on this render; focus it once it exists.
    queueMicrotask(() => zoneRef.current?.focus());
  };

  /** The one success path, so MUT-191 (a note after a Business profile) can extend it. */
  const onCreated = (profile: HostedProfile) => {
    showToast(t('hosted.profiles.created', { name: profile.name }), { tone: 'info' });
    void navigate({ to: `/p/${profile.id}` });
  };

  const onSubmit = async (values: CreateProfileFormValues) => {
    if (submitting.current || atCap) return;
    submitting.current = true;
    const body = { ...values, name: values.name.trim() } as CreateProfileRequest;
    setBanner(null);
    try {
      const profile = await create.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
      attempt.succeeded();
      onCreated(profile);
    } catch (error) {
      const mapped = mapProfileError(error);
      if (mapped.refetchMe) void queryClient.invalidateQueries({ queryKey: ME_KEY });
      if (mapped.capReached) setCapReached(true);
      if (mapped.field) {
        if (mapped.field.field === 'timezone') setZoneOpen(true);
        setError(mapped.field.field, { type: 'server', message: mapped.field.key });
      }
      if (mapped.banner && !mapped.capReached) setBanner(mapped.banner);
    } finally {
      submitting.current = false;
    }
  };

  const fieldError = (field: keyof CreateProfileFormValues) => {
    const message = formState.errors[field]?.message;
    return message ? (
      <p className="form-error" id={`${FORM_ID}-${field}-error`}>
        {t(message)}
      </p>
    ) : null;
  };

  return (
    <Drawer
      title={t('hosted.profiles.newTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} aria-disabled={create.isPending || atCap || undefined}>
            {create.isPending ? t('hosted.profiles.creating') : t('hosted.profiles.create')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate>
        {atCap && <ProfileBanner banner={capBanner} />}
        {banner && <ProfileBanner banner={banner} />}

        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-name`}>
            {t('hosted.profiles.name')}
          </label>
          <input
            id={`${FORM_ID}-name`}
            className="input"
            dir="auto"
            autoComplete="off"
            aria-invalid={Boolean(formState.errors.name)}
            aria-describedby={formState.errors.name ? `${FORM_ID}-name-error` : undefined}
            {...register('name')}
          />
          {fieldError('name')}
        </div>

        <div className="form-group">
          <span className="form-label" id={`${FORM_ID}-type-label`}>
            {t('hosted.profiles.type')}
          </span>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <ProfileTypeCards
                name={`${FORM_ID}-type`}
                value={field.value}
                onChange={field.onChange}
                labelledBy={`${FORM_ID}-type-label`}
                describedBy={`${FORM_ID}-type-hint`}
                invalid={Boolean(formState.errors.type)}
              />
            )}
          />
          <p className="form-hint" id={`${FORM_ID}-type-hint`}>
            {t('hosted.profiles.typeHint')}
          </p>
          {fieldError('type')}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-currency`}>
            {t('hosted.profiles.currency')}
          </label>
          <Select id={`${FORM_ID}-currency`} hint={t('hosted.profiles.currencyHintNew')} {...register('defaultCurrency')}>
            {HOSTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
          {fieldError('defaultCurrency')}
        </div>

        <div className="form-group">
          {zoneOpen ? (
            <>
              <label className="form-label" htmlFor={`${FORM_ID}-timezone`}>
                {t('hosted.profiles.timezone')}
              </label>
              <Controller
                name="timezone"
                control={control}
                render={({ field }) => (
                  <Select
                    id={`${FORM_ID}-timezone`}
                    dir="ltr"
                    invalid={Boolean(formState.errors.timezone)}
                    {...field}
                    ref={(element) => {
                      field.ref(element);
                      zoneRef.current = element;
                    }}
                  >
                    {zones.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </>
          ) : (
            <>
              <span className="form-label">{t('hosted.profiles.timezone')}</span>
              <p className="hp-fact-row">
                <bdi dir="ltr">{zone}</bdi> <span className="hp-muted">{t('hosted.profiles.timezoneFromBrowser')}</span> ·{' '}
                <button type="button" className="hp-link-button" onClick={revealZone}>
                  {t('hosted.profiles.timezoneChange')}
                </button>
              </p>
            </>
          )}
          <p className="form-hint">{t('hosted.profiles.timezoneHint')}</p>
          {fieldError('timezone')}
        </div>
      </form>
    </Drawer>
  );
}
