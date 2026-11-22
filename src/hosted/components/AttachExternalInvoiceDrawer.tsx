import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useDirection, useLanguage } from '../../lib/i18n/core';
import { useTheme } from '../../lib/theme';
import { ApiError, apiErrorReason, api, type ExternalEntryKind, type ExternalInvoice, type HostedProfile } from '../api/client';
import { isoDateOf, useAttachExternalInvoice, useRemoveExternalInvoice } from '../data/externalInvoiceQueries';
import type { Currency } from '../api/client';
import { formatDecimal } from '../format/DecimalAmount';
import { Drawer } from './Drawer';
import emptyDark from './art/invoicing-empty-attach-dark.svg';
import emptyDarkRtl from './art/invoicing-empty-attach-dark-rtl.svg';
import emptyLight from './art/invoicing-empty-attach-light.svg';
import emptyLightRtl from './art/invoicing-empty-attach-light-rtl.svg';
import readingDark from './art/invoicing-reading-dark.svg';
import readingDarkRtl from './art/invoicing-reading-dark-rtl.svg';
import readingLight from './art/invoicing-reading-light.svg';
import readingLightRtl from './art/invoicing-reading-light-rtl.svg';

/**
 * MUT-647 (round 3, A+B): an invoice issued elsewhere, attached to the Owed or Received it belongs to. Choose or drop
 * the file (or drop it on the entry's row), the server reads its number, date and total, the person confirms or
 * corrects them, and it is kept with the entry. An amount that differs from the entry's is said, never blocked. Once
 * attached, the same drawer shows it: open the file, or remove it (then MTB3A may issue the entry's document).
 */
export interface ExternalEntry {
  kind: ExternalEntryKind;
  id: string;
  client: string;
  /** The entry's amount (gross), a decimal string. */
  amount: string;
  currency: Currency;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Two decimal strings as minor units, so "1500" and "1,500.00" compare equal (no floating point). */
function minorOf(raw: string): bigint | null {
  const s = raw.replace(/[,\s]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  return m ? BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')) : null;
}

function useArt(light: string, lightRtl: string, dark: string, darkRtl: string): string {
  const { resolvedTheme } = useTheme();
  const rtl = useDirection() === 'rtl';
  return resolvedTheme === 'dark' ? (rtl ? darkRtl : dark) : rtl ? lightRtl : light;
}

export function AttachExternalInvoiceDrawer({ profile, entry, existing, initialFile, onClose }: { profile: HostedProfile; entry: ExternalEntry; existing: ExternalInvoice | null; initialFile?: File | null; onClose: () => void }) {
  const { t, language } = useLanguage();
  const formId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const attach = useAttachExternalInvoice(profile.id);
  const remove = useRemoveExternalInvoice(profile.id);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fields, setFields] = useState({ number: '', date: '', amount: '' });
  const [tried, setTried] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const emptyArt = useArt(emptyLight, emptyLightRtl, emptyDark, emptyDarkRtl);
  const readingArt = useArt(readingLight, readingLightRtl, readingDark, readingDarkRtl);

  const take = async (chosen: File) => {
    setFileError(null);
    if (!TYPES.includes(chosen.type)) return setFileError(t('hosted.external.wrongType'));
    if (chosen.size > MAX_BYTES) return setFileError(t('hosted.external.tooLarge'));
    setFile(chosen);
    setReading(true);
    try {
      const read = await api.readExternalInvoice(profile.id, chosen);
      setFields({ number: read.number ?? '', date: read.documentDate ?? '', amount: read.amount ?? '' });
    } catch {
      setFields({ number: '', date: '', amount: '' });
    } finally {
      setReading(false);
    }
  };
  // A file dropped on the entry's row arrives here once.
  const [started, setStarted] = useState(false);
  if (initialFile && !started) {
    setStarted(true);
    void take(initialFile);
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void take(dropped);
  };

  const date = isoDateOf(fields.date);
  const numberOk = fields.number.trim().length > 0 && fields.number.trim().length <= 64;
  const typed = minorOf(fields.amount);
  const mismatch = typed !== null && typed !== minorOf(entry.amount);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!file || !numberOk || !date) return;
    attach.mutate({ query: { entryKind: entry.kind, entryId: entry.id, number: fields.number.trim(), documentDate: date, filename: file.name || 'invoice' }, file }, { onSuccess: onClose });
  };
  const openFile = async (id: string) => {
    setOpenFailed(false);
    try {
      window.open((await api.externalInvoiceFile(profile.id, id)).url, '_blank', 'noopener');
    } catch {
      setOpenFailed(true);
    }
  };
  const refusal = attach.error instanceof ApiError ? (apiErrorReason(attach.error) === 'EXTERNAL_INVOICE_EXISTS' ? t('hosted.external.exists') : apiErrorReason(attach.error) === 'ISSUED_HERE' ? t('hosted.external.issuedHere') : t('hosted.external.failed')) : attach.error ? t('hosted.external.failed') : null;
  const kindLabel = t(entry.kind === 'OWED' ? 'hosted.external.owed' : 'hosted.external.received');
  const entryLine = `${kindLabel} · ${entry.client} · ${formatDecimal(entry.amount, entry.currency, language)}`;

  return (
    <Drawer
      title={existing ? t('hosted.external.attachedTitle') : t('hosted.external.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        !existing && file && !reading ? (
          <div className="drawer-footer-right">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form={formId} isLoading={attach.isPending} keepLabelWhileLoading data-testid="external-attach">
              {t('hosted.external.attach')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <p className="hp-muted" data-testid="external-entry">
        <bdi>{entryLine}</bdi>
      </p>
      {existing ? (
        <section className="hp-external-card" data-testid="external-attached">
          <p className="hp-external-badge">{t('hosted.external.badge')}</p>
          <h3>{t('hosted.external.invoiceNumber', { number: existing.number })}</h3>
          <p className="hp-muted">{existing.documentDate}</p>
          <div className="hp-setup-actions">
            <Button onClick={() => void openFile(existing.id)} data-testid="external-open">
              {t('hosted.external.open')}
            </Button>
            <Button variant="ghost" onClick={() => remove.mutate(existing.id, { onSuccess: onClose })} disabled={remove.isPending} data-testid="external-remove">
              {t('hosted.external.remove')}
            </Button>
          </div>
          {openFailed && (
            <p className="input-error-message" role="alert">
              {t('hosted.external.openFailed')}
            </p>
          )}
          <p className="hp-muted">{t('hosted.external.noIssueWhileAttached')}</p>
        </section>
      ) : !file ? (
        <div
          className="hp-external-drop"
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="external-drop"
        >
          <img src={emptyArt} alt="" width={160} height={120} decoding="async" />
          <p>{t('hosted.external.drop')}</p>
          <p className="hp-muted">{t('hosted.external.dropHint')}</p>
          <input ref={picker} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="external-file" onChange={(e) => e.target.files?.[0] && void take(e.target.files[0])} />
          <Button variant="secondary" onClick={() => picker.current?.click()}>
            {t('hosted.external.choose')}
          </Button>
          {fileError && (
            <p className="input-error-message" role="alert">
              {fileError}
            </p>
          )}
        </div>
      ) : reading ? (
        <div className="hp-external-reading" role="status" data-testid="external-reading">
          <img src={readingArt} alt="" width={240} height={160} decoding="async" />
          <p>{t('hosted.external.reading')}</p>
        </div>
      ) : (
        <form id={formId} className="hp-issue-form" onSubmit={submit} noValidate data-testid="external-confirm">
          <p className="hp-muted">
            <bdi>{file.name}</bdi>
          </p>
          <Input label={t('hosted.external.number')} id={`${formId}-number`} value={fields.number} dir="ltr" maxLength={64} onChange={(e) => setFields({ ...fields, number: e.target.value })} error={tried && !numberOk ? t('hosted.external.numberRequired') : undefined} />
          <Input label={t('hosted.external.date')} id={`${formId}-date`} value={fields.date} dir="ltr" placeholder="YYYY-MM-DD" onChange={(e) => setFields({ ...fields, date: e.target.value })} error={tried && !date ? t('hosted.external.dateInvalid') : undefined} />
          <Input label={t('hosted.external.amount')} id={`${formId}-amount`} value={fields.amount} dir="ltr" inputMode="decimal" onChange={(e) => setFields({ ...fields, amount: e.target.value })} />
          {typed !== null && (
            <p className={mismatch ? 'hp-external-mismatch' : 'hp-muted'} role="status" data-testid="external-amount-note">
              {mismatch ? t('hosted.external.amountDiffers', { amount: formatDecimal(entry.amount, entry.currency, language) }) : t('hosted.external.amountMatches')}
            </p>
          )}
          <p className="hp-muted">{t('hosted.external.staysExternal')}</p>
          {refusal && (
            <p className="input-error-message" role="alert">
              {refusal}
            </p>
          )}
        </form>
      )}
    </Drawer>
  );
}
