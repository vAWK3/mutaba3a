import { useState, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { EmptyState } from '../../components/ui';
import {
  useEngagements,
  useEngagementDisplay,
  useEngagementCountByStatus,
  useArchiveEngagement,
  useRestoreEngagement,
  useDuplicateEngagement,
  useLatestVersion,
} from '../../features/engagements/hooks/useEngagementQueries';
import { downloadEngagementPdf } from '../../features/engagements/pdf';
import { useClients, useBusinessProfiles } from '../../hooks/useQueries';
import { useToast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { EngagementFilters, EngagementStatus, EngagementType, EngagementCategory, EngagementDisplay } from '../../features/engagements/types';
import './EngagementsPage.css';

type ViewFilter = 'all' | 'draft' | 'final' | 'archived';

export function EngagementsPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();

  // Filter state
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [typeFilter, setTypeFilter] = useState<EngagementType | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<EngagementCategory | undefined>(undefined);
  const [profileFilter, setProfileFilter] = useState<string | undefined>(undefined);
  const [clientFilter, setClientFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Build query filters
  const queryFilters = useMemo((): EngagementFilters => {
    const filters: EngagementFilters = {
      search: search || undefined,
      profileId: profileFilter,
      clientId: clientFilter,
      type: typeFilter,
      category: categoryFilter,
      includeArchived: viewFilter === 'archived',
    };

    // View-based status filter
    if (viewFilter === 'draft') {
      filters.status = 'draft';
    } else if (viewFilter === 'final') {
      filters.status = 'final';
    } else if (viewFilter === 'archived') {
      filters.status = 'archived';
    }

    return filters;
  }, [viewFilter, typeFilter, categoryFilter, profileFilter, clientFilter, search]);

  const { data: engagements = [], isLoading } = useEngagements(queryFilters);
  const { data: counts } = useEngagementCountByStatus();
  const { data: profiles = [] } = useBusinessProfiles();
  const { data: clients = [] } = useClients();
  const { data: selectedEngagement } = useEngagementDisplay(selectedId || '');

  const handleRowClick = (id: string) => {
    setSelectedId(id);
  };

  const handleNewEngagement = () => {
    navigate({ to: '/engagements/new' });
  };

  const handleEditEngagement = (id: string) => {
    navigate({ to: '/engagements/$engagementId/edit', params: { engagementId: id } });
  };

  return (
    <>
      <TopBar
        title={t('engagements.title')}
        rightSlot={
          <div className="topbar-actions">
            <button className="btn btn-primary" onClick={handleNewEngagement}>
              + {t('engagements.new')}
            </button>
          </div>
        }
      />
      <div className="engagements-layout">
        {/* Left Filter Panel */}
        <aside className="engagements-filter-panel">
          <div className="filter-section">
            <h4 className="filter-section-title">{t('engagements.filters.view')}</h4>
            <div className="filter-radio-group">
              {(['all', 'draft', 'final', 'archived'] as ViewFilter[]).map((view) => (
                <label key={view} className={cn('filter-radio', viewFilter === view && 'active')}>
                  <input
                    type="radio"
                    name="view"
                    checked={viewFilter === view}
                    onChange={() => setViewFilter(view)}
                  />
                  <span>{t(`engagements.filters.${view}`)}</span>
                  {counts && view !== 'all' && (
                    <span className="filter-count">{counts[view as EngagementStatus]}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h4 className="filter-section-title">{t('engagements.filters.type')}</h4>
            <select
              className="select filter-select"
              value={typeFilter || ''}
              onChange={(e) => setTypeFilter(e.target.value as EngagementType | undefined || undefined)}
            >
              <option value="">{t('common.all')}</option>
              <option value="task">{t('engagements.type.task')}</option>
              <option value="retainer">{t('engagements.type.retainer')}</option>
            </select>
          </div>

          <div className="filter-section">
            <h4 className="filter-section-title">{t('engagements.filters.category')}</h4>
            <select
              className="select filter-select"
              value={categoryFilter || ''}
              onChange={(e) => setCategoryFilter(e.target.value as EngagementCategory | undefined || undefined)}
            >
              <option value="">{t('common.all')}</option>
              <option value="design">{t('engagements.category.design')}</option>
              <option value="development">{t('engagements.category.development')}</option>
              <option value="consulting">{t('engagements.category.consulting')}</option>
              <option value="marketing">{t('engagements.category.marketing')}</option>
              <option value="legal">{t('engagements.category.legal')}</option>
              <option value="other">{t('engagements.category.other')}</option>
            </select>
          </div>

          <div className="filter-section">
            <h4 className="filter-section-title">{t('engagements.filters.profile')}</h4>
            <select
              className="select filter-select"
              value={profileFilter || ''}
              onChange={(e) => setProfileFilter(e.target.value || undefined)}
            >
              <option value="">{t('common.all')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <h4 className="filter-section-title">{t('engagements.filters.client')}</h4>
            <select
              className="select filter-select"
              value={clientFilter || ''}
              onChange={(e) => setClientFilter(e.target.value || undefined)}
            >
              <option value="">{t('common.all')}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('engagements.searchPlaceholder')}
            />
          </div>

          {/* Summary Stats */}
          {counts && (
            <div className="filter-section engagements-summary">
              <h4 className="filter-section-title">{t('engagements.summary')}</h4>
              <div className="engagements-summary-stat">
                <span className="engagements-summary-label">{t('engagements.draftCount')}</span>
                <span className="engagements-summary-value">{counts.draft}</span>
              </div>
              <div className="engagements-summary-stat">
                <span className="engagements-summary-label">{t('engagements.finalCount')}</span>
                <span className="engagements-summary-value">{counts.final}</span>
              </div>
              <div className="engagements-summary-stat">
                <span className="engagements-summary-label">{t('engagements.archivedCount')}</span>
                <span className="engagements-summary-value">{counts.archived}</span>
              </div>
            </div>
          )}
        </aside>

        {/* Main Table */}
        <main className="engagements-main">
          {isLoading ? (
            <div className="loading">
              <div className="spinner" />
            </div>
          ) : engagements.length === 0 ? (
            <EmptyState
              title={t('engagements.empty')}
              description={search ? t('engagements.emptySearch') : t('engagements.emptyHint')}
              action={!search ? {
                label: t('engagements.addEngagement'),
                onClick: handleNewEngagement,
              } : undefined}
            />
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('engagements.columns.status')}</th>
                    <th>{t('engagements.columns.title')}</th>
                    <th>{t('engagements.columns.client')}</th>
                    <th>{t('engagements.columns.type')}</th>
                    <th>{t('engagements.columns.category')}</th>
                    <th>{t('engagements.columns.language')}</th>
                    <th>{t('engagements.columns.versions')}</th>
                    <th>{t('engagements.columns.updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {engagements.map((engagement) => (
                    <tr
                      key={engagement.id}
                      className={cn('clickable', selectedId === engagement.id && 'selected')}
                      onClick={() => handleRowClick(engagement.id)}
                    >
                      <td>
                        <EngagementStatusBadge status={engagement.status} />
                      </td>
                      <td className="cell-primary">{engagement.title || t('engagements.untitled')}</td>
                      <td>{engagement.clientName || '-'}</td>
                      <td>
                        <span className="type-badge">
                          {t(`engagements.type.${engagement.type}`)}
                        </span>
                      </td>
                      <td>
                        <span className="category-badge">
                          {t(`engagements.category.${engagement.category}`)}
                        </span>
                      </td>
                      <td>
                        <span className={cn('language-badge', `lang-${engagement.primaryLanguage}`)}>
                          {engagement.primaryLanguage === 'ar' ? 'AR' : 'EN'}
                        </span>
                      </td>
                      <td className="cell-center">{engagement.versionCount || 0}</td>
                      <td>
                        {engagement.updatedAt
                          ? new Date(engagement.updatedAt).toLocaleDateString(locale, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Right Inspector Panel */}
        <aside className={cn('engagements-inspector', selectedId && 'visible')}>
          {selectedEngagement ? (
            <EngagementInspector
              engagement={selectedEngagement}
              onClose={() => setSelectedId(undefined)}
              onEdit={() => handleEditEngagement(selectedEngagement.id)}
            />
          ) : (
            <div className="inspector-placeholder">
              <p>{t('engagements.selectToInspect')}</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

// Status Badge Component
function EngagementStatusBadge({ status }: { status: EngagementStatus }) {
  const t = useT();
  return (
    <span className={cn('status-badge', `status-${status}`)}>
      {t(`engagements.status.${status}`)}
    </span>
  );
}

// Inspector Panel Component
interface EngagementInspectorProps {
  engagement: EngagementDisplay;
  onClose: () => void;
  onEdit: () => void;
}

function EngagementInspector({ engagement, onClose, onEdit }: EngagementInspectorProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const [isDownloading, setIsDownloading] = useState(false);
  const { showToast } = useToast();

  const archiveMutation = useArchiveEngagement();
  const restoreMutation = useRestoreEngagement();
  const duplicateMutation = useDuplicateEngagement();
  const { data: latestVersion } = useLatestVersion(engagement.id);
  const { data: clients = [] } = useClients();
  const { data: profiles = [] } = useBusinessProfiles();

  const handleArchive = () => {
    if (confirm(t('engagements.confirmArchive'))) {
      archiveMutation.mutate(engagement.id);
    }
  };

  const handleRestore = () => {
    restoreMutation.mutate(engagement.id);
  };

  const handleDuplicate = () => {
    duplicateMutation.mutate(
      { id: engagement.id },
      {
        onSuccess: (newEngagement) => {
          navigate({ to: '/engagements/$engagementId/edit', params: { engagementId: newEngagement.id } });
        },
      }
    );
  };

  const handleDownloadPdf = async () => {
    if (!snapshot) return;
    setIsDownloading(true);
    try {
      const client = clients.find((c) => c.id === engagement.clientId);
      const profile = profiles.find((p) => p.id === snapshot.profileId);
      const result = await downloadEngagementPdf({
        snapshot,
        client,
        language: engagement.primaryLanguage,
        type: engagement.type,
        category: engagement.category,
        profile,
      });
      if (result.success) {
        showToast('PDF downloaded');
      } else {
        console.error('PDF generation failed:', result.error);
        showToast('Failed to download PDF. Please try again.');
      }
    } catch (error) {
      console.error('Failed to download PDF:', error);
      showToast('Failed to download PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const snapshot = latestVersion?.snapshot;

  return (
    <div className="inspector-content">
      <div className="inspector-header">
        <h3 className="inspector-title">{engagement.title || t('engagements.untitled')}</h3>
        <button className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
          <CloseIcon />
        </button>
      </div>

      {/* Overview Section */}
      <div className="inspector-section">
        <h4 className="inspector-section-title">{t('engagements.inspector.overview')}</h4>
        <dl className="inspector-details">
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.client')}</dt>
            <dd>{engagement.clientName || t('common.noClient')}</dd>
          </div>
          {engagement.projectName && (
            <div className="inspector-detail">
              <dt>{t('engagements.inspector.project')}</dt>
              <dd>{engagement.projectName}</dd>
            </div>
          )}
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.type')}</dt>
            <dd>{t(`engagements.type.${engagement.type}`)}</dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.category')}</dt>
            <dd>{t(`engagements.category.${engagement.category}`)}</dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.language')}</dt>
            <dd>{engagement.primaryLanguage === 'ar' ? 'Arabic' : 'English'}</dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.status')}</dt>
            <dd><EngagementStatusBadge status={engagement.status} /></dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.versions')}</dt>
            <dd>{engagement.versionCount || 0}</dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('engagements.inspector.created')}</dt>
            <dd>{new Date(engagement.createdAt).toLocaleDateString(locale)}</dd>
          </div>
          {engagement.lastVersionAt && (
            <div className="inspector-detail">
              <dt>{t('engagements.inspector.lastUpdated')}</dt>
              <dd>{new Date(engagement.lastVersionAt).toLocaleDateString(locale)}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Summary from Latest Version */}
      {snapshot?.summary && (
        <div className="inspector-section">
          <h4 className="inspector-section-title">{t('engagements.inspector.summary')}</h4>
          <p className="inspector-summary">{snapshot.summary}</p>
        </div>
      )}

      {/* Deliverables Count */}
      {snapshot && (
        <div className="inspector-section">
          <h4 className="inspector-section-title">{t('engagements.inspector.scope')}</h4>
          <dl className="inspector-details">
            <div className="inspector-detail">
              <dt>{t('engagements.inspector.deliverables')}</dt>
              <dd>{snapshot.deliverables?.length || 0}</dd>
            </div>
            <div className="inspector-detail">
              <dt>{t('engagements.inspector.exclusions')}</dt>
              <dd>{snapshot.exclusions?.length || 0}</dd>
            </div>
            <div className="inspector-detail">
              <dt>{t('engagements.inspector.milestones')}</dt>
              <dd>{snapshot.milestones?.length || 0}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Actions */}
      <div className="inspector-actions">
        {engagement.status !== 'archived' && (
          <button className="btn btn-primary" onClick={onEdit}>
            {engagement.status === 'final' ? t('common.view') : t('common.edit')}
          </button>
        )}
        {engagement.status === 'final' && snapshot && (
          <button
            className="btn btn-secondary"
            onClick={handleDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? t('common.downloading') : t('engagements.downloadPdf')}
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={handleDuplicate}
          disabled={duplicateMutation.isPending}
        >
          {t('engagements.duplicate')}
        </button>
        {engagement.status === 'archived' ? (
          <button
            className="btn btn-secondary"
            onClick={handleRestore}
            disabled={restoreMutation.isPending}
          >
            {t('engagements.restore')}
          </button>
        ) : (
          <button
            className="btn btn-danger"
            onClick={handleArchive}
            disabled={archiveMutation.isPending}
          >
            {t('engagements.archive')}
          </button>
        )}
      </div>
    </div>
  );
}

// Icons
function CloseIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
