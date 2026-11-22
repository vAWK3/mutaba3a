import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { DocumentsPreference } from '../../api/client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea } from '../../../components/ui/Input';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { useT } from '../../../lib/i18n/core';
import { ApiError, api, apiErrorReason, type IssuerDetails, type IssuingSettings } from '../../api/client';
import { profileKey } from '../../session/me';
import { completeNumber, useBusinessLookup } from '../../data/customerQueries';
import { useIssuingStyles } from '../../data/issuedQueries';
import { useAnswerNumbering, useSaveIssuer, useSaveIssuerDefaults, useSaveIssuerLogo } from '../../data/issuingQueries';
import { DEFAULT_INK, INKS, wholeNumber, type PaperModel } from './setupSteps';

/** MUT-660: the documents preference choices, in the order the client page offers them. */
const DOCUMENTS_PREFERENCES: readonly DocumentsPreference[] = ['TAX_INVOICE_FIRST', 'PAYMENT_REQUEST_FIRST', 'ON_PAYMENT', 'NO_DOCUMENT'];

/**
 * MUT-646: the five steps' forms. Each saves on its own (AC2) and moves on; each reports what it holds while typed
 * (`onPreview`), so the letterhead follows the form before anything is saved (AC3).
 */
type Preview = (patch: Partial<PaperModel>) => void;
interface StepProps {
  profileId: string;
  onPreview: Preview;
  onDone: () => void;
}

const DEALER_TYPES = ['LICENSED', 'EXEMPT', 'COMPANY', 'NONPROFIT'] as const;
/** MUT-570 (Basel): the styles come from the server, so a new one appears without a portal release; until it answers, these. */
const KNOWN_STYLES = ['PROFESSIONAL', 'MODERN', 'MINIMAL'];
const LANGUAGES = ['he', 'ar', 'en'] as const;
// MUT-662: a payment request has its own series, so it is asked like the others.
const DOC_TYPES = ['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE', 'PAYMENT_REQUEST'] as const;
export const LOGO_MAX_BYTES = 256 * 1024;

function SaveError({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const changed = error instanceof ApiError && apiErrorReason(error) === 'VERSION_MISMATCH';
  return (
    <p className="input-error-message" role="alert">
      {t(changed ? 'hosted.invoicing.changedElsewhere' : 'hosted.invoicing.saveFailed')}
    </p>
  );
}

function StepActions({ pending, onLater }: { pending: boolean; onLater?: () => void }) {
  const t = useT();
  return (
    <div className="hp-setup-actions">
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? t('common.saving') : t('hosted.invoicing.next')}
      </Button>
      {onLater && (
        <Button type="button" variant="secondary" onClick={onLater} disabled={pending}>
          {t('hosted.invoicing.later')}
        </Button>
      )}
    </div>
  );
}

/** Step 1: the details every document prints. A company or nonprofit number fills the name and address from the registry. */
export function DetailsStep({ profileId, issuer, onPreview, onDone }: StepProps & { issuer: IssuerDetails | null }) {
  const t = useT();
  const save = useSaveIssuer(profileId);
  const [form, setForm] = useState({
    vatId: issuer?.vatId ?? '',
    legalName: issuer?.legalName ?? '',
    dealerType: issuer?.dealerType ?? ('LICENSED' as PaperModel['dealerType']),
    address: issuer?.address ?? '',
    city: issuer?.city ?? '',
    phone: issuer?.phone ?? '',
    email: issuer?.email ?? '',
  });
  const [tried, setTried] = useState(false);
  const number = completeNumber(form.vatId);
  const lookup = useBusinessLookup(profileId, number);
  const found = number && lookup.data ? lookup.data : null;
  // The registry fills what is still empty, once per number (adjusted while rendering, not in an effect).
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const [filledPatch, setFilledPatch] = useState<Partial<PaperModel> | null>(null);
  if (found && number !== filledFrom) {
    setFilledFrom(number);
    const patch = {
      ...(!form.legalName.trim() && found.name ? { legalName: found.name } : {}),
      ...(!form.address.trim() && found.address ? { address: found.address } : {}),
      dealerType: found.kind === 'nonprofit' ? ('NONPROFIT' as const) : ('COMPANY' as const),
    };
    setForm({ ...form, ...patch });
    setFilledPatch(patch);
  }
  // The letterhead is the page's state: told after this render, never during it (review fix).
  // Once per fill, whatever the caller passes as onPreview (a new function each render must not re-fire it).
  const previewRef = useRef(onPreview);
  useEffect(() => {
    previewRef.current = onPreview;
  });
  useEffect(() => {
    if (filledPatch) previewRef.current(filledPatch);
  }, [filledPatch]);

  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setForm({ ...form, [key]: value });
    onPreview({ [key]: value } as Partial<PaperModel>);
  };
  const invalid = lookup.error instanceof ApiError && apiErrorReason(lookup.error) === 'TAX_ID_INVALID';
  const numberError = (tried && !number) || invalid ? t('hosted.invoicing.details.invalid') : undefined;
  const nameError = tried && !form.legalName.trim() ? t('hosted.invoicing.details.legalNameRequired') : undefined;
  const emailError = tried && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? t('hosted.invoicing.details.emailInvalid') : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!number || invalid || !form.legalName.trim() || emailError || (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))) return;
    const body = {
      vatId: number,
      legalName: form.legalName.trim(),
      dealerType: form.dealerType,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
    };
    save.mutate({ version: issuer?.version ?? null, body }, { onSuccess: onDone });
  };

  return (
    <form className="hp-setup-form" onSubmit={submit} noValidate>
      <Input
        id="issuer-vat-id"
        label={t('hosted.invoicing.details.vatId')}
        value={form.vatId}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        maxLength={20}
        onChange={set('vatId')}
        hint={t('hosted.invoicing.details.vatIdHint')}
        error={numberError}
      />
      {found && (
        <p className="hp-business-found" role="status">
          {t('hosted.invoicing.details.found', { name: found.name })}
        </p>
      )}
      <Input id="issuer-legal-name" label={t('hosted.invoicing.details.legalName')} value={form.legalName} dir="auto" maxLength={200} onChange={set('legalName')} error={nameError} />
      <Select id="issuer-dealer-type" label={t('hosted.invoicing.details.dealerType')} value={form.dealerType} onChange={set('dealerType')}>
        {DEALER_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(`hosted.invoicing.details.dealer.${type}`)}
          </option>
        ))}
      </Select>
      <Input id="issuer-address" label={t('hosted.invoicing.details.address')} value={form.address} dir="auto" maxLength={300} onChange={set('address')} />
      <Input id="issuer-city" label={t('hosted.invoicing.details.city')} value={form.city} dir="auto" maxLength={100} onChange={set('city')} />
      <div className="hp-setup-pair">
        <Input id="issuer-phone" label={t('hosted.invoicing.details.phone')} value={form.phone} dir="ltr" type="tel" maxLength={40} onChange={set('phone')} />
        <Input id="issuer-email" label={t('hosted.invoicing.details.email')} value={form.email} dir="ltr" type="email" maxLength={200} onChange={set('email')} error={emailError} />
      </div>
      <SaveError error={save.error} />
      <StepActions pending={save.isPending} />
    </form>
  );
}

/** Step 2: the logo, optional. Checked here for size; the server checks it is an image the PDF can print. */
export function LogoStep({ profileId, hasLogo, onPreview, onDone }: StepProps & { hasLogo: boolean }) {
  const t = useT();
  const save = useSaveIssuerLogo(profileId);
  const picker = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const notImage = save.error instanceof ApiError && (apiErrorReason(save.error) === 'LOGO_NOT_AN_IMAGE' || save.error.status === 413);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTooLarge(file.size > LOGO_MAX_BYTES);
    if (file.size > LOGO_MAX_BYTES) return;
    save.mutate(file, { onSuccess: () => onPreview({}) });
  };

  return (
    <form
      className="hp-setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        onDone();
      }}
    >
      <p className="hp-muted">{t('hosted.invoicing.logo.hint')}</p>
      <input ref={picker} type="file" accept="image/png,image/jpeg" className="sr-only" data-testid="logo-file" onChange={pick} tabIndex={-1} aria-hidden="true" />
      <div className="hp-setup-actions">
        <Button type="button" variant="secondary" onClick={() => picker.current?.click()} disabled={save.isPending}>
          {save.isPending ? t('hosted.invoicing.logo.uploading') : t(hasLogo ? 'hosted.invoicing.logo.replace' : 'hosted.invoicing.logo.choose')}
        </Button>
        {hasLogo && (
          <Button type="button" variant="ghost" onClick={() => save.mutate(null)} disabled={save.isPending}>
            {t('hosted.invoicing.logo.remove')}
          </Button>
        )}
      </div>
      {tooLarge && (
        <p className="input-error-message" role="alert">
          {t('hosted.invoicing.logo.tooLarge')}
        </p>
      )}
      {notImage ? (
        <p className="input-error-message" role="alert">
          {t('hosted.invoicing.logo.notImage')}
        </p>
      ) : (
        <SaveError error={save.error} />
      )}
      {hasLogo && <p className="hp-muted">{t('hosted.invoicing.logo.kept')}</p>}
      <StepActions pending={save.isPending} onLater={hasLogo ? undefined : onDone} />
    </form>
  );
}

/** Step 3: what new documents start with. Needs the details first: they share one record and its version. */
export function DefaultsStep({ profileId, issuer, onPreview, onDone }: StepProps & { issuer: IssuerDetails | null }) {
  const t = useT();
  const save = useSaveIssuerDefaults(profileId);
  const styles = useIssuingStyles(profileId);
  const [form, setForm] = useState({
    documentStyle: (issuer?.documentStyle ?? 'PROFESSIONAL') as PaperModel['style'],
    ink: (issuer?.ink ?? DEFAULT_INK) as PaperModel['ink'],
    defaultLanguage: (issuer?.defaultLanguage ?? 'he') as PaperModel['language'],
    pricesIncludeVat: issuer?.pricesIncludeVat ?? false,
    paymentTermsDays: issuer?.paymentTermsDays == null ? '' : String(issuer.paymentTermsDays),
    bankDetails: issuer?.bankDetails ?? '',
    footerNote: issuer?.footerNote ?? '',
    offerAfterSave: issuer?.offerAfterSave ?? true,
    defaultDocumentsPreference: (issuer?.defaultDocumentsPreference ?? 'ON_PAYMENT') as DocumentsPreference,
  });
  if (!issuer) return <p className="hp-muted">{t('hosted.invoicing.defaults.needsDetails')}</p>;

  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K], paper?: Partial<PaperModel>) => {
    setForm({ ...form, [key]: value });
    if (paper) onPreview(paper);
  };
  const days = form.paymentTermsDays.trim() === '' ? null : wholeNumber(form.paymentTermsDays);
  const daysInvalid = form.paymentTermsDays.trim() !== '' && (days === null || days > 365);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (daysInvalid) return;
    const body = { documentStyle: form.documentStyle, ink: form.ink, defaultLanguage: form.defaultLanguage, pricesIncludeVat: form.pricesIncludeVat, paymentTermsDays: days, bankDetails: form.bankDetails.trim() || null, footerNote: form.footerNote.trim() || null, offerAfterSave: form.offerAfterSave, defaultDocumentsPreference: form.defaultDocumentsPreference };
    save.mutate({ version: issuer.version, body }, { onSuccess: onDone });
  };

  const labelled = (id: string, label: string) => (
    <span id={id} className="hp-setup-label">
      {label}
    </span>
  );
  return (
    <form className="hp-setup-form" onSubmit={submit} noValidate>
      {labelled('issuer-style-label', t('hosted.invoicing.defaults.style'))}
      <SegmentedControl
        labelledBy="issuer-style-label"
        value={form.documentStyle}
        options={(styles.data?.styles.map((style) => style.key) ?? KNOWN_STYLES).map((value) => ({ value: value as PaperModel['style'], label: t(`hosted.invoicing.defaults.styles.${value}`) }))}
        onChange={(value) => change('documentStyle', value, { style: value })}
      />
      {labelled('issuer-ink-label', t('hosted.invoicing.defaults.ink'))}
      <SegmentedControl labelledBy="issuer-ink-label" value={form.ink} options={INKS.map((value) => ({ value, label: t(`hosted.invoicing.defaults.inks.${value}`) }))} onChange={(value) => change('ink', value, { ink: value })} />
      {labelled('issuer-language-label', t('hosted.invoicing.defaults.language'))}
      <SegmentedControl
        labelledBy="issuer-language-label"
        value={form.defaultLanguage}
        options={LANGUAGES.map((value) => ({ value, label: t(`hosted.invoicing.defaults.languages.${value}`) }))}
        onChange={(value) => change('defaultLanguage', value, { language: value })}
      />
      {labelled('issuer-vat-label', t('hosted.invoicing.defaults.pricesIncludeVat'))}
      <SegmentedControl
        labelledBy="issuer-vat-label"
        value={form.pricesIncludeVat ? 'yes' : 'no'}
        options={[
          { value: 'no', label: t('hosted.invoicing.defaults.no') },
          { value: 'yes', label: t('hosted.invoicing.defaults.yes') },
        ]}
        onChange={(value) => change('pricesIncludeVat', value === 'yes')}
      />
      <Input
        id="issuer-payment-terms"
        label={t('hosted.invoicing.defaults.paymentTerms')}
        hint={t('hosted.invoicing.defaults.paymentTermsHint')}
        value={form.paymentTermsDays}
        dir="ltr"
        inputMode="numeric"
        maxLength={3}
        onChange={(e) => change('paymentTermsDays', e.target.value)}
        error={daysInvalid ? t('hosted.invoicing.defaults.paymentTermsInvalid') : undefined}
      />
      <Textarea id="issuer-bank" label={t('hosted.invoicing.defaults.bankDetails')} value={form.bankDetails} dir="auto" maxLength={300} rows={2} onChange={(e) => change('bankDetails', e.target.value, { bankDetails: e.target.value })} />
      <Textarea id="issuer-footer" label={t('hosted.invoicing.defaults.footerNote')} value={form.footerNote} dir="auto" maxLength={300} rows={2} onChange={(e) => change('footerNote', e.target.value, { footerNote: e.target.value })} />
      {labelled('issuer-offer-label', t('hosted.invoicing.defaults.offerAfterSave'))}
      <SegmentedControl
        labelledBy="issuer-offer-label"
        value={form.offerAfterSave ? 'yes' : 'no'}
        options={[
          { value: 'yes', label: t('hosted.invoicing.defaults.yes') },
          { value: 'no', label: t('hosted.invoicing.defaults.no') },
        ]}
        onChange={(value) => change('offerAfterSave', value === 'yes')}
      />
      {/* MUT-660: the documents a client with no preference of its own is due. */}
      <label htmlFor="issuer-documents-preference" className="hp-filter-label">
        {t('hosted.invoicing.defaults.documentsPreference')}
      </label>
      <Select id="issuer-documents-preference" value={form.defaultDocumentsPreference} onChange={(e) => change('defaultDocumentsPreference', e.target.value as DocumentsPreference)}>
        {DOCUMENTS_PREFERENCES.map((p) => (
          <option key={p} value={p}>
            {t(`hosted.client.documents.choices.${p}`)}
          </option>
        ))}
      </Select>
      <p className="hp-muted">{t('hosted.invoicing.defaults.documentsPreferenceHint')}</p>
      <SaveError error={save.error} />
      <StepActions pending={save.isPending} onLater={onDone} />
    </form>
  );
}

/** Step 4: "already issuing elsewhere?" A type that already has documents here keeps its numbering (D3). */
export function NumberingStep({ profileId, answered, counters, onPreview, onDone }: StepProps & { answered: boolean; counters: IssuingSettings | undefined }) {
  const t = useT();
  const save = useAnswerNumbering(profileId);
  const [already, setAlready] = useState<'no' | 'yes'>('no');
  const [starts, setStarts] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const fixed = new Set(counters?.counters.filter((c) => c.hasDocuments).map((c) => c.docType) ?? []);
  // A type already issued here keeps its numbering: whatever was typed before the counters arrived isn't sent.
  const entries = Object.entries(starts).filter(([type, v]) => v.trim() !== '' && !fixed.has(type as never));
  const valid = entries.every(([, v]) => (wholeNumber(v) ?? 0) >= 1);
  const missing = already === 'yes' && entries.length === 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (already === 'yes' && (missing || !valid)) return;
    const body = already === 'yes' ? { alreadyIssuing: true, starts: Object.fromEntries(entries.map(([k, v]) => [k, wholeNumber(v) ?? 1])) } : { alreadyIssuing: false };
    save.mutate(body, { onSuccess: onDone });
  };
  const hasDocs = save.error instanceof ApiError && apiErrorReason(save.error) === 'HAS_DOCUMENTS';

  return (
    <form className="hp-setup-form" onSubmit={submit} noValidate>
      <span id="issuer-numbering-label" className="hp-setup-label">
        {t('hosted.invoicing.numbering.question')}
      </span>
      <SegmentedControl
        labelledBy="issuer-numbering-label"
        value={already}
        options={[
          { value: 'no', label: t('hosted.invoicing.numbering.no') },
          { value: 'yes', label: t('hosted.invoicing.numbering.yes') },
        ]}
        onChange={(value) => {
          setAlready(value);
          onPreview({ nextNumber: value === 'yes' ? wholeNumber(starts.TAX_INVOICE ?? '') || 1 : 1 });
        }}
      />
      {already === 'no' ? (
        <p className="hp-muted">{t('hosted.invoicing.numbering.fromOne')}</p>
      ) : (
        DOC_TYPES.map((type) => (
          <Input
            key={type}
            id={`issuer-start-${type}`}
            label={t('hosted.invoicing.numbering.nextOf', { type: t(`hosted.invoicing.docTypes.${type}`) })}
            value={starts[type] ?? ''}
            dir="ltr"
            inputMode="numeric"
            maxLength={9}
            disabled={fixed.has(type)}
            hint={fixed.has(type) ? t('hosted.invoicing.numbering.fixed') : undefined}
            onChange={(e) => {
              setStarts({ ...starts, [type]: e.target.value });
              if (type === 'TAX_INVOICE') onPreview({ nextNumber: wholeNumber(e.target.value) || 1 });
            }}
          />
        ))
      )}
      {tried && (missing || !valid) && (
        <p className="input-error-message" role="alert">
          {t('hosted.invoicing.numbering.atLeastOne')}
        </p>
      )}
      {hasDocs ? (
        <p className="input-error-message" role="alert">
          {t('hosted.invoicing.numbering.fixed')}
        </p>
      ) : (
        <SaveError error={save.error} />
      )}
      {answered && !save.isPending && <p className="hp-muted">{t('hosted.invoicing.complete')}</p>}
      <StepActions pending={save.isPending} />
    </form>
  );
}

/**
 * Step 5 (MUT-571): connect the profile to the Tax Authority, for allocation numbers. Connect opens the Tax Authority's
 * own sign-in (the business owner signs in there; MTB3A never sees the password) and comes back here. A server without
 * the connection configured answers 404: the step then says it will be available.
 */
export function TaxAuthorityStep({ profileId, onDone }: { profileId: string; onDone: () => void }) {
  const t = useT();
  const status = useQuery({ queryKey: profileKey(profileId, 'issuing', 'tax-authority'), queryFn: ({ signal }) => api.taxAuthorityStatus(profileId, signal), retry: false });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const returned = new URLSearchParams(window.location.search).get('taxAuthority');
  const connect = async () => {
    setBusy(true);
    setFailed(false);
    try {
      window.location.assign((await api.taxAuthorityConnect(profileId)).authorizeUrl);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await api.taxAuthorityDisconnect(profileId);
    } finally {
      setBusy(false);
      void status.refetch();
    }
  };
  const state = status.data?.state;
  return (
    <div className="hp-setup-form" data-testid="tax-authority-step">
      {status.error ? (
        <p>{t('hosted.invoicing.taxAuthority.body')}</p>
      ) : state === 'connected' ? (
        <p role="status" data-testid="tax-authority-connected">
          {t('hosted.invoicing.taxAuthority.connected', { until: status.data!.until?.slice(0, 10) ?? '' })}
        </p>
      ) : (
        <p>{t(state === 'expired' ? 'hosted.invoicing.taxAuthority.expired' : 'hosted.invoicing.taxAuthority.connectBody')}</p>
      )}
      {returned === 'failed' && state !== 'connected' && (
        <p className="input-error-message" role="alert">
          {t('hosted.invoicing.taxAuthority.returnedFailed')}
        </p>
      )}
      {failed && (
        <p className="input-error-message" role="alert">
          {t('hosted.invoicing.saveFailed')}
        </p>
      )}
      <div className="hp-setup-actions">
        {status.data && state !== 'connected' && (
          <Button type="button" onClick={() => void connect()} disabled={busy} data-testid="tax-authority-connect">
            {t('hosted.invoicing.taxAuthority.connect')}
          </Button>
        )}
        {state === 'connected' && (
          <Button type="button" variant="ghost" onClick={() => void disconnect()} disabled={busy}>
            {t('hosted.invoicing.taxAuthority.disconnect')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          {t(state === 'connected' ? 'hosted.invoicing.next' : 'hosted.invoicing.later')}
        </Button>
      </div>
    </div>
  );
}
