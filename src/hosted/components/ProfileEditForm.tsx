import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { HostedProfile, ProfileType, ProfileTypeChange, UpdateProfileRequest, UpdateProfileResponse } from '../api/client';
import { changedFields, profileEditability } from '../data/profileRules';
import { fetchTypeChangePreview, useUpdateProfile } from '../data/profileQueries';
import { HOSTED_CURRENCIES } from '../format/currencies';
import { ME_KEY, meQuery } from '../session/me';
import { ProfileBanner } from './ProfileBanner';
import { ProfileTypeCards } from './ProfileTypeCards';
import { mapProfileError, type ProfileBanner as Banner } from './profileApiErrors';
import { editProfileSchema, type EditProfileValues } from './profileFormSchema';

/**
 * One owned profile's edit pane (MUT-183 plan §2.4, design review Issue 2):
 * name and currency first, the time zone as a fact, and the type last in its
 * own group because changing it replaces the categories.
 *
 * The If-Match version is the one read when the pane opened, never re-read at
 * save time (MUT-196's lost-update class): a change made elsewhere meanwhile
 * comes back as a conflict, and Reload is the user's explicit choice.
 *
 * A type change asks first (plan §2.5): Save fetches the server's preview, the
 * form gives way to an inline confirm with the count, and only then is the one
 * PATCH sent. The buttons render into the drawer's footer through `footerSlot`.
 */

const FORM_ID = 'hosted-profile-edit-form';

type Step = { kind: 'form' } | { kind: 'checking' } | { kind: 'confirm'; to: ProfileType; preview: ProfileTypeChange; patch: UpdateProfileRequest };

export interface ProfileEditFormProps {
  profile: HostedProfile;
  footerSlot: HTMLElement | null;
  onSaved: (result: UpdateProfileResponse) => void;
  /** Leave for the list, optionally with a banner to show there (403, 404). */
  onLeave: (banner: Banner | null) => void;
}

const valuesOf = (profile: HostedProfile): EditProfileValues => ({
  name: profile.name,
  defaultCurrency: profile.defaultCurrency,
  type: profile.type ?? 'PERSONAL',
});

const typeLabel = (type: ProfileType) => (type === 'BUSINESS' ? 'hosted.profiles.kind.business' : 'hosted.profiles.kind.personal');

export function ProfileEditForm({ profile, footerSlot, onSaved, onLeave }: ProfileEditFormProps) {
  const t = useT();
  const tp = useTp();
  const queryClient = useQueryClient();
  const update = useUpdateProfile(profile.id);
  // The profile as it was when the pane opened: its version is the If-Match.
  const [opened, setOpened] = useState(profile);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [conflict, setConflict] = useState(false);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const typeLocked = profileEditability(opened).editable && opened.isPersonalDefault;

  const form = useForm<EditProfileValues>({ resolver: zodResolver(editProfileSchema), defaultValues: valuesOf(profile) });
  const { control, handleSubmit, setError, formState, register, reset } = form;
  const values = useWatch({ control }) as EditProfileValues;
  const dirty = Object.keys(changedFields(opened, values)).length > 0;
  const busy = update.isPending || step.kind === 'checking';

  useEffect(() => {
    if (step.kind === 'confirm') confirmHeading.current?.focus();
  }, [step.kind]);

  const fail = (error: unknown) => {
    const mapped = mapProfileError(error);
    if (mapped.refetchMe) void queryClient.invalidateQueries({ queryKey: ME_KEY });
    if (mapped.backToList) {
      onLeave(mapped.banner ?? null);
      return;
    }
    setStep({ kind: 'form' });
    if (mapped.field && mapped.field.field !== 'timezone') setError(mapped.field.field, { type: 'server', message: mapped.field.key });
    setConflict(Boolean(mapped.conflict));
    setBanner(mapped.banner ?? null);
  };

  const save = async (patch: UpdateProfileRequest) => {
    try {
      onSaved(await update.mutateAsync({ body: patch, version: opened.version }));
    } catch (error) {
      fail(error);
    }
  };

  const onSubmit = async (submitted: EditProfileValues) => {
    if (busy) return;
    const patch = changedFields(opened, submitted);
    if (Object.keys(patch).length === 0) return;
    setBanner(null);
    setConflict(false);
    if (!patch.type) {
      await save(patch);
      return;
    }
    setStep({ kind: 'checking' });
    try {
      const preview = await fetchTypeChangePreview(queryClient, profile.id, patch.type);
      setStep({ kind: 'confirm', to: patch.type, preview, patch });
    } catch (error) {
      fail(error);
    }
  };

  const reload = async () => {
    const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    const fresh = me.profiles.find((candidate) => candidate.id === profile.id);
    if (!fresh || !fresh.owned) {
      onLeave({ tone: 'error', key: 'hosted.profiles.errors.gone' });
      return;
    }
    setOpened(fresh);
    reset(valuesOf(fresh));
    setBanner(null);
    setConflict(false);
  };

  const backFromConfirm = () => {
    setStep({ kind: 'form' });
    queueMicrotask(() => saveButton.current?.focus());
  };

  const fieldError = (field: keyof EditProfileValues) => {
    const message = formState.errors[field]?.message;
    return message ? <p className="form-error">{t(message)}</p> : null;
  };

  const footer =
    step.kind === 'confirm' ? (
      <>
        <Button type="button" variant="secondary" onClick={backFromConfirm}>
          {t('hosted.profiles.confirm.back')}
        </Button>
        <Button type="button" variant="danger" aria-disabled={update.isPending || undefined} onClick={() => !update.isPending && void save(step.patch)}>
          {update.isPending ? t('common.saving') : t('hosted.profiles.confirm.action', { type: t(typeLabel(step.to)) })}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" variant="secondary" onClick={() => onLeave(null)}>
          {t('common.cancel')}
        </Button>
        <Button ref={saveButton} type="submit" form={FORM_ID} aria-disabled={busy || !dirty || undefined}>
          {step.kind === 'checking' ? t('hosted.profiles.checking') : update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </>
    );

  return (
    <>
      {footerSlot && createPortal(footer, footerSlot)}
      <button type="button" className="hp-link-button hp-back" onClick={() => onLeave(null)}>
        {t('hosted.profiles.back')}
      </button>
      {banner && (
        <ProfileBanner banner={banner}>
          {conflict && (
            <>
              {' '}
              <button type="button" className="hp-link-button" onClick={() => void reload()}>
                {t('hosted.profiles.reload')}
              </button>
            </>
          )}
        </ProfileBanner>
      )}

      {step.kind === 'confirm' ? (
        <section className="hp-confirm" aria-labelledby={`${FORM_ID}-confirm-title`}>
          <h3 id={`${FORM_ID}-confirm-title`} ref={confirmHeading} tabIndex={-1}>
            {t('hosted.profiles.confirm.title', { type: t(typeLabel(step.to)) })}
          </h3>
          <p>{t('hosted.profiles.confirm.body', { type: t(typeLabel(step.to)) })}</p>
          <p className="hp-confirm-count">
            {step.preview.uncategorizedExpenses > 0 ? tp('hosted.profiles.confirm.count', step.preview.uncategorizedExpenses) : t('hosted.profiles.confirm.none')}
          </p>
        </section>
      ) : (
        <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor={`${FORM_ID}-name`}>
              {t('hosted.profiles.name')}
            </label>
            <input id={`${FORM_ID}-name`} className="input" dir="auto" autoComplete="off" aria-invalid={Boolean(formState.errors.name)} {...register('name')} />
            {fieldError('name')}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`${FORM_ID}-currency`}>
              {t('hosted.profiles.currency')}
            </label>
            <Select id={`${FORM_ID}-currency`} hint={t('hosted.profiles.currencyHintEdit')} {...register('defaultCurrency')}>
              {HOSTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
            {fieldError('defaultCurrency')}
          </div>

          <dl className="hp-facts">
            <dt>{t('hosted.profiles.timezone')}</dt>
            <dd>
              <bdi dir="ltr">{opened.timezone}</bdi>
            </dd>
          </dl>

          <div className="form-group hp-type-group">
            <span className="form-label" id={`${FORM_ID}-type-label`}>
              {t('hosted.profiles.typeGroup')}
            </span>
            {typeLocked ? (
              <p className="form-hint">{t('hosted.profiles.builtInLocked')}</p>
            ) : (
              <>
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
                    />
                  )}
                />
                <p className="form-hint" id={`${FORM_ID}-type-hint`}>
                  {t('hosted.profiles.typeGroupHint')}
                </p>
              </>
            )}
          </div>
        </form>
      )}
    </>
  );
}
