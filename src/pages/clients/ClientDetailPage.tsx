import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { OwedNowSummary } from '../../components/clients/OwedNowSummary';
import { ClientWorkSection } from '../../components/clients/ClientWorkSection';
import { ClientPaymentsSection } from '../../components/clients/ClientPaymentsSection';
import { ClientRetainersCard } from '../../components/clients/ClientRetainersCard';
import { useFeatureEnabled } from '../../lib/features/useFeatures';
import { useClient } from '../../hooks/useQueries';
import { useReceivables } from '../../hooks/useIncomeQueries';
import { summarizeOwedByCurrency } from '../../db/aggregations';
import { useDrawerStore } from '../../lib/stores';
import { todayLocalISO } from '../../lib/dates';
import { useT } from '../../lib/i18n';

/**
 * The client profile (MUT-3): one page answering the product's three
 * questions with no tab clicks --
 *   how much do they owe me?   the header's Owed Now
 *   what did I do for them?    Work and billing
 *   when did they pay, for what?  Payments
 */
export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' });
  const { openClientDrawer } = useDrawerStore();
  const retainersEnabled = useFeatureEnabled('retainers');
  const t = useT();

  const { data: client, isLoading: clientLoading } = useClient(clientId);
  // Unfiltered on purpose: Owed Now is not a period figure (D5)
  const { data: receivables = [] } = useReceivables({ clientId });
  const today = todayLocalISO();
  const owed = useMemo(() => summarizeOwedByCurrency(receivables, today), [receivables, today]);

  if (clientLoading) {
    return (
      <>
        <TopBar title={t('common.loading')} breadcrumbs={[{ label: t('nav.clients'), href: '/clients' }]} />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!client) {
    return (
      <>
        <TopBar title={t('clients.notFound')} breadcrumbs={[{ label: t('nav.clients'), href: '/clients' }]} />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('clients.notFound')}</h3>
            <p className="empty-state-description">{t('clients.notFoundHint')}</p>
          </div>
        </div>
      </>
    );
  }

  const contact = [client.email, client.phone].filter(Boolean);

  return (
    <>
      <TopBar
        title={client.name}
        breadcrumbs={[{ label: t('nav.clients'), href: '/clients' }, { label: client.name }]}
        rightSlot={
          <button className="btn btn-ghost" onClick={() => openClientDrawer({ mode: 'edit', clientId })}>
            {t('common.edit')}
          </button>
        }
      />
      <div className="page-content client-profile">
        <header className="card client-profile-header">
          {(contact.length > 0 || client.notes) && (
            <div className="client-profile-contact">
              {contact.map((value) => (
                <bdi key={value} dir="ltr" className="client-profile-contact-item">
                  {value}
                </bdi>
              ))}
              {client.notes && <p className="client-profile-notes">{client.notes}</p>}
            </div>
          )}
          <OwedNowSummary owed={owed} />
        </header>

        <ClientWorkSection clientId={clientId} />
        <ClientPaymentsSection clientId={clientId} />

        {retainersEnabled && <ClientRetainersCard clientId={client.id} />}
      </div>
    </>
  );
}
