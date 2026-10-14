import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Input, Select, Textarea } from '../../../components/ui/Input';
import '../../../components/ui/Button.css';
import { useLanguage, useT } from '../../../lib/i18n';
import { isolate } from '../../../lib/utils';
import { WEB_APP_URL } from '../../../content/download-config';
import {
  DEVICES,
  HONEYPOT_FIELD,
  PROFESSIONS,
  emptyHostedRequest,
  submitHostedRequest,
  validateHostedRequest,
  type Device,
  type HostedRequestErrors,
  type HostedRequestValues,
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
  const [values, setValues] = useState<HostedRequestValues>(() => emptyHostedRequest(language));
  const [errors, setErrors] = useState<HostedRequestErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const focusEmailOnReturn = useRef(false);

  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
    if (status === 'idle' && focusEmailOnReturn.current) {
      focusEmailOnReturn.current = false;
      emailRef.current?.focus();
    }
  }, [status]);

  const update = <K extends keyof HostedRequestValues>(key: K, value: HostedRequestValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === 'name' || key === 'email') setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const toggleDevice = (device: Device) =>
    update('devices', values.devices.includes(device) ? values.devices.filter((d) => d !== device) : [...values.devices, device]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'sending') return;
    const found = validateHostedRequest(values);
    setErrors(found);
    if (found.name || found.email) {
      (found.name ? nameRef : emailRef).current?.focus();
      return;
    }
    setStatus('sending');
    const result = await submitHostedRequest({ ...values, language });
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
  const sending = status === 'sending';

  return (
    <>
      {status === 'error' && (
        <p className="hosted-alert" role="alert">
          {t(`${T}.form.errorAlert`)}
        </p>
      )}
      <form className="hosted-form" aria-labelledby={titleId} noValidate onSubmit={handleSubmit}>
        <Input
          ref={nameRef}
          id="hosted-name"
          name="name"
          label={t(`${T}.form.name`)}
          autoComplete="name"
          required
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          error={errors.name ? t(`${T}.form.errName`) : undefined}
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
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
          error={errors.email ? t(`${T}.form.errEmail`, { example: isolate(EXAMPLE_EMAIL) }) : undefined}
        />
        <Input
          id="hosted-phone"
          name="phone"
          type="tel"
          dir="ltr"
          label={optional('phone')}
          autoComplete="tel"
          value={values.phone}
          onChange={(e) => update('phone', e.target.value)}
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
          id="hosted-message"
          name="message"
          label={optional('message')}
          rows={4}
          value={values.message}
          onChange={(e) => update('message', e.target.value)}
        />
        <div className="hosted-honeypot" aria-hidden="true">
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
        <button type="submit" className="btn btn-primary btn-lg hosted-submit" disabled={sending}>
          {t(`${T}.form.${sending ? 'sending' : status === 'error' ? 'retry' : 'send'}`)}
        </button>
        <p className="hosted-notice">
          {t(`${T}.form.notice`)} <a href="/privacy">{t(`${T}.form.privacyLink`)}</a>
        </p>
      </form>
    </>
  );
}
