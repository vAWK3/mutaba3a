import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Input, Select, Textarea } from '../../../components/ui/Input';
import '../../../components/ui/Button.css';
import { useLanguage, useT } from '../../../lib/i18n';
import { isolate } from '../../../lib/utils';
import { WEB_APP_URL } from '../../../content/download-config';
import {
  DEVICES,
  FIELD_MAX_LENGTH,
  HONEYPOT_FIELD,
  newRequestId,
  PROFESSIONS,
  EMPTY_HOSTED_ANSWERS,
  submitHostedRequest,
  validateHostedRequest,
  type Device,
  type HostedRequestAnswers,
  type HostedRequestError,
  type HostedRequestErrors,
  type Profession,
} from '../hostedRequest';

type Status = 'idle' | 'sending' | 'success' | 'error';

/** The address shown in the email error, so the expected shape is concrete. */
const EXAMPLE_EMAIL = 'name@example.com';

const T = 'landing.hostedOffer';

/**
 * The hosted-account request form (MUT-186). Posts to Netlify Forms; the
 * visitor sees errors inline, a disabled button while sending, a retry on
 * failure and, on success, their own name and email with a way to fix a
 * mistyped address (2A). Never more than one request in flight.
 */
export function HostedRequestForm({ titleId }: { titleId: string }) {
  const t = useT();
  const { language } = useLanguage();
  const [values, setValues] = useState<HostedRequestAnswers>(EMPTY_HOSTED_ANSWERS);
  const [errors, setErrors] = useState<HostedRequestErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  // One id for this form's life: retries and corrections of one request share it
  const [requestId] = useState(newRequestId);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const focusEmailOnReturn = useRef(false);

  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
    // The alert pushes the button down; bring both into view wherever the page was scrolled
    if (status === 'error') alertRef.current?.scrollIntoView?.({ block: 'nearest' });
    if (status === 'idle' && focusEmailOnReturn.current) {
      focusEmailOnReturn.current = false;
      emailRef.current?.focus();
    }
  }, [status]);

  const update = <K extends keyof HostedRequestAnswers>(key: K, value: HostedRequestAnswers[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in FIELD_MAX_LENGTH) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const toggleDevice = (device: Device) =>
    update('devices', values.devices.includes(device) ? values.devices.filter((d) => d !== device) : [...values.devices, device]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'sending') return;
    const found = validateHostedRequest(values);
    setErrors(found);
    const firstInvalid = (['name', 'email', 'phone', 'message'] as const).find((field) => found[field]);
    if (firstInvalid) {
      ({ name: nameRef, email: emailRef, phone: phoneRef, message: messageRef })[firstInvalid].current?.focus();
      return;
    }
    setStatus('sending');
    // The language the page is in now, not when the form mounted (D4)
    const result = await submitHostedRequest({ ...values, language, requestId });
    setStatus(result === 'ok' ? 'success' : 'error');
  };

  if (status === 'success') {
    return (
      <div className="hosted-success" role="status">
        <h3 ref={successRef} tabIndex={-1} className="hosted-success-title">
          {t(`${T}.success.title`)}
        </h3>
        <p>
          {t(`${T}.success.body`, { name: isolate(values.name.trim()), email: isolate(values.email.trim()) })}
        </p>
        <button
          type="button"
          className="hosted-success-edit"
          onClick={() => {
            focusEmailOnReturn.current = true;
            setStatus('idle');
          }}
        >
          {t(`${T}.success.edit`)}
        </button>
        <a href={WEB_APP_URL} className="hosted-success-free">
          {t(`${T}.success.freeApp`)}
        </a>
      </div>
    );
  }

  const optional = (label: string) => `${t(`${T}.form.${label}`)} ${t(`${T}.form.optional`)}`;
  const errorText = (field: keyof typeof FIELD_MAX_LENGTH, error: HostedRequestError | undefined) => {
    if (!error) return undefined;
    if (error === 'tooLong') return t(`${T}.form.errTooLong`, { max: FIELD_MAX_LENGTH[field] });
    return field === 'name' ? t(`${T}.form.errName`) : t(`${T}.form.errEmail`, { example: isolate(EXAMPLE_EMAIL) });
  };
  const sending = status === 'sending';

  return (
    <form className="hosted-form" aria-labelledby={titleId} noValidate onSubmit={handleSubmit}>
      <Input
        ref={nameRef}
        id="hosted-name"
        name="name"
        label={t(`${T}.form.name`)}
        autoComplete="name"
        required
        maxLength={FIELD_MAX_LENGTH.name}
        value={values.name}
        onChange={(e) => update('name', e.target.value)}
        error={errorText('name', errors.name)}
      />
      <Input
        ref={emailRef}
        id="hosted-email"
        name="email"
        type="email"
        dir="ltr"
        label={t(`${T}.form.email`)}
        autoComplete="email"
        required
        maxLength={FIELD_MAX_LENGTH.email}
        value={values.email}
        onChange={(e) => update('email', e.target.value)}
        error={errorText('email', errors.email)}
      />
      <Input
        ref={phoneRef}
        id="hosted-phone"
        name="phone"
        type="tel"
        dir="ltr"
        label={optional('phone')}
        autoComplete="tel"
        maxLength={FIELD_MAX_LENGTH.phone}
        value={values.phone}
        onChange={(e) => update('phone', e.target.value)}
        error={errorText('phone', errors.phone)}
      />
      <Select
        id="hosted-profession"
        name="profession"
        label={optional('profession')}
        value={values.profession}
        onChange={(e) => update('profession', e.target.value as Profession | '')}
      >
        <option value="">{t(`${T}.form.professionPlaceholder`)}</option>
        {PROFESSIONS.map((profession) => (
          <option key={profession} value={profession}>
            {t(`${T}.form.professions.${profession}`)}
          </option>
        ))}
      </Select>
      <fieldset className="hosted-devices-field">
        <legend className="input-label">{optional('devices')}</legend>
        <div className="hosted-device-pills">
          {DEVICES.map((device) => (
            <label key={device} className="hosted-device-pill">
              <input
                type="checkbox"
                name="devices"
                value={device}
                checked={values.devices.includes(device)}
                onChange={() => toggleDevice(device)}
              />
              {t(`${T}.form.deviceOptions.${device}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <Textarea
        ref={messageRef}
        id="hosted-message"
        name="message"
        label={optional('message')}
        rows={4}
        maxLength={FIELD_MAX_LENGTH.message}
        value={values.message}
        onChange={(e) => update('message', e.target.value)}
        error={errorText('message', errors.message)}
      />
      {/* hidden = display: none, which autofill skips; off-screen alone gets filled */}
      <div className="hosted-honeypot" hidden aria-hidden="true">
        <label htmlFor="hosted-honeypot">{t(`${T}.form.honeypot`)}</label>
        <input
          id="hosted-honeypot"
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          value={values.honeypot}
          onChange={(e) => update('honeypot', e.target.value)}
        />
      </div>
      {/* Beside the button, where the visitor is looking when it fails (moved from above the form after the browser check) */}
      {status === 'error' && (
        <p ref={alertRef} className="hosted-alert" role="alert">
          {t(`${T}.form.errorAlert`)}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg hosted-submit" disabled={sending}>
        {t(`${T}.form.${sending ? 'sending' : status === 'error' ? 'retry' : 'send'}`)}
      </button>
      <p className="hosted-notice">
        {t(`${T}.form.notice`)} <a href="/privacy">{t(`${T}.form.privacyLink`)}</a> · <a href="/terms">{t(`${T}.form.termsLink`)}</a>
      </p>
    </form>
  );
}
