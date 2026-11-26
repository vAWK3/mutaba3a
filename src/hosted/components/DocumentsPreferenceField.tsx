import { useId } from 'react';
import { Select } from '../../components/ui/Input';
import { useLanguage } from '../../lib/i18n/core';
import { ApiError, type Customer, type DocumentsPreference } from '../api/client';
import { useUpdateCustomer } from '../data/customerQueries';
import { useInvoicingWorthAsking, useIssuingSetup } from '../data/issuingQueries';
import { useOptionalProfile } from '../session/me';

/** "Profile default" first: no value of the client's own (null). */
const CHOICES: ReadonlyArray<DocumentsPreference | 'DEFAULT'> = ['DEFAULT', 'TAX_INVOICE_FIRST', 'PAYMENT_REQUEST_FIRST', 'ON_PAYMENT', 'NO_DOCUMENT'];

/**
 * MUT-660 (wireframe screen 4): which documents a client is due, on an invoicing profile. A select that saves itself
 * (If-Match), with one line saying what is due for this client and that the choice also changes how their past income
 * counts. Hidden where invoicing is off (the setup answers 404) and on this device.
 */
export function DocumentsPreferenceField({ profileId, client, writable, profileDefault }: { profileId: string; client: Customer; writable: boolean; profileDefault: DocumentsPreference }) {
  const { t } = useLanguage();
  const id = useId();
  const ask = useInvoicingWorthAsking(useOptionalProfile());
  const setup = useIssuingSetup(profileId, ask);
  const update = useUpdateCustomer(profileId, client.id);
  if (!ask || !setup.data) return null;
  const current = client.documentsPreference ?? null;
  const effective = current ?? profileDefault;
  const changedElsewhere = update.error instanceof ApiError && update.error.status === 409;
  return (
    <div className="hp-business-docs" data-testid="client-documents-preference">
      <label htmlFor={id}>{t('hosted.client.documents.label')}</label>
      <Select
        id={id}
        value={current ?? 'DEFAULT'}
        disabled={!writable || update.isPending}
        onChange={(e) => {
          const value = e.target.value as DocumentsPreference | 'DEFAULT';
          update.mutate({ version: client.version, body: { documentsPreference: value === 'DEFAULT' ? null : value } });
        }}
      >
        {CHOICES.map((c) => (
          <option key={c} value={c}>
            {c === 'DEFAULT' ? t('hosted.client.documents.default', { choice: t(`hosted.client.documents.choices.${profileDefault}`) }) : t(`hosted.client.documents.choices.${c}`)}
          </option>
        ))}
      </Select>
      {update.isSuccess && !update.isPending && (
        <p className="hp-muted" role="status">
          {t('hosted.client.documents.saved')}
        </p>
      )}
      {changedElsewhere && <p className="input-error-message" role="alert">{t('hosted.client.business.changedElsewhere')}</p>}
      {update.isError && !changedElsewhere && <p className="input-error-message" role="alert">{t('hosted.client.business.saveFailed')}</p>}
      <p className="hp-business-docs-due">
        <span className="hp-muted">{t('hosted.client.documents.dueTitle')}</span> {t(`hosted.client.documents.due.${effective}`)}
      </p>
    </div>
  );
}
