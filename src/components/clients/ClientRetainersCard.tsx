import { useNavigate } from '@tanstack/react-router';
import { useRetainers } from '../../hooks/useRetainerQueries';
import { useDrawerStore } from '../../lib/stores';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { formatAmount, formatDate } from '../../lib/utils';

export interface ClientRetainersCardProps {
  clientId: string;
}

/**
 * Retainer status for one client on the client profile's Summary tab
 * (MUT-13). Rendered only while the Retainers area is on; the page decides.
 * Read-only list plus two entry points: New retainer, View all.
 */
export function ClientRetainersCard({ clientId }: ClientRetainersCardProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const { openRetainerDrawer } = useDrawerStore();
  const { data: retainers = [], isLoading } = useRetainers({ clientId });

  return (
    <div className="card" style={{ marginBottom: 16 }} data-testid="client-retainers-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4>{t('clients.detail.retainers.title')}</h4>
        <div style={{ display: 'flex', gap: 8 }}>
          {retainers.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigate({ to: '/retainers', search: { clientId } })}
            >
              {t('clients.detail.retainers.viewAll')}
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => openRetainerDrawer({ mode: 'create', defaultClientId: clientId })}
          >
            {t('clients.detail.retainers.new')}
          </button>
        </div>
      </div>

      {isLoading ? null : retainers.length === 0 ? (
        <p className="text-muted">{t('clients.detail.retainers.empty')}</p>
      ) : (
        <ul className="client-retainers-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {retainers.map((retainer) => (
            <li
              key={retainer.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', gap: 12 }}
            >
              <div>
                <div>
                  {retainer.projectName || retainer.clientName || t('clients.detail.retainers.title')}{' '}
                  <span className={`status-badge ${retainer.status}`}>{t(`retainers.status.${retainer.status}`)}</span>
                </div>
                {retainer.nextExpectedDate && (
                  <div className="text-muted text-sm">
                    {t('clients.detail.retainers.nextExpected')}: {formatDate(retainer.nextExpectedDate, locale)}
                  </div>
                )}
              </div>
              {retainer.dueNowAmountMinor > 0 && (
                <div className="text-sm" style={{ textAlign: 'end' }}>
                  <div className="text-muted">{t('clients.detail.retainers.dueNow')}</div>
                  <div>{formatAmount(retainer.dueNowAmountMinor, retainer.currency)}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
