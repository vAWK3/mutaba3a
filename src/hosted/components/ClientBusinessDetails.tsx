import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useLanguage } from '../../lib/i18n/core';
import { ApiError, apiErrorReason, type BusinessLookup, type Customer } from '../api/client';
import { completeNumber, useBusinessLookup, useUpdateCustomer } from '../data/customerQueries';
import { useIsLocalMode } from '../session/mode';

/**
 * MUT-642: a client's VAT or company number and address, the two lines a tax
 * invoice prints under the client's name. Typing a complete 9-digit number
 * asks the registry (hosted only): a company or nonprofit fills an empty
 * address and shows its registered name; a dissolved one shows a warning; a
 * sole dealer is in no registry, so the person types the details.
 */

export function ClientBusinessDetails({ profileId, client, writable }: { profileId: string; client: Customer; writable: boolean }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);

  return (
    <section className="hp-card hp-business" aria-label={t('hosted.client.business.title')}>
      <div className="hp-business-head">
        <h2 className="hp-business-title">{t('hosted.client.business.title')}</h2>
        {writable && !editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {client.taxId || client.address ? t('hosted.client.business.edit') : t('hosted.client.business.add')}
          </Button>
        )}
      </div>
      {editing ? (
        <BusinessForm profileId={profileId} client={client} onDone={() => setEditing(false)} />
      ) : (
        <dl className="hp-business-list">
          <dt>{t('hosted.client.business.taxId')}</dt>
          <dd dir="ltr">{client.taxId ?? '—'}</dd>
          <dt>{t('hosted.client.business.address')}</dt>
          <dd>{client.address ?? '—'}</dd>
        </dl>
      )}
    </section>
  );
}

function BusinessForm({ profileId, client, onDone }: { profileId: string; client: Customer; onDone: () => void }) {
  const { t } = useLanguage();
  const local = useIsLocalMode();
  const [taxId, setTaxId] = useState(client.taxId ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const number = completeNumber(taxId);
  const lookup = useBusinessLookup(profileId, local ? null : number);
  const update = useUpdateCustomer(profileId, client.id);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  const found: BusinessLookup | undefined = lookup.data && lookup.data.taxId === number ? lookup.data : undefined;
  // The registry's address fills an empty field once per number (adjusted while rendering); what the person typed stays.
  if (found && filledFrom !== found.taxId) {
    setFilledFrom(found.taxId);
    if (found.address && !address.trim()) setAddress(found.address);
  }

  const invalid = (lookup.error instanceof ApiError && apiErrorReason(lookup.error) === 'TAX_ID_INVALID') || (update.error instanceof ApiError && apiErrorReason(update.error) === 'TAX_ID_INVALID');
  const notInRegistry = lookup.error instanceof ApiError && apiErrorReason(lookup.error) === 'NOT_IN_REGISTRY';
  const registryDown = lookup.error instanceof ApiError && lookup.error.code === 'REGISTRY_UNAVAILABLE';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await update.mutateAsync({ version: client.version, body: { taxId: number ?? (taxId.trim() || null), address: address.trim() || null } }).then(onDone, () => undefined);
  };

  return (
    <form className="hp-business-form" onSubmit={submit} noValidate>
      <Input
        label={t('hosted.client.business.taxId')}
        id="client-tax-id"
        value={taxId}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        maxLength={20}
        onChange={(e) => setTaxId(e.target.value)}
        error={invalid ? t('hosted.client.business.invalid') : undefined}
        hint={t('hosted.client.business.taxIdHint')}
      />
      {lookup.isFetching && <p className="hp-muted" role="status">{t('hosted.client.business.looking')}</p>}
      {found && (
        <p className="hp-business-found" role="status">
          {t(found.kind === 'company' ? 'hosted.client.business.foundCompany' : 'hosted.client.business.foundNonprofit', { name: found.name })}
        </p>
      )}
      {found && !found.active && (
        <p className="hp-business-warning" role="alert">
          {t('hosted.client.business.inactive', { status: found.status })}
        </p>
      )}
      {notInRegistry && <p className="hp-muted" role="status">{t('hosted.client.business.notInRegistry')}</p>}
      {registryDown && <p className="hp-muted" role="status">{t('hosted.client.business.registryDown')}</p>}
      <Input
        label={t('hosted.client.business.address')}
        id="client-address"
        value={address}
        maxLength={300}
        onChange={(e) => setAddress(e.target.value)}
      />
      {update.isError && !invalid && <p className="input-error-message" role="alert">{t('hosted.client.business.saveFailed')}</p>}
      <div className="hp-business-actions">
        <Button type="submit" variant="primary" size="sm" disabled={update.isPending}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone} disabled={update.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
