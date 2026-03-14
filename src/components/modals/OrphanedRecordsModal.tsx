import { useState, useMemo, useCallback } from 'react';
import { useBusinessProfiles, useUpdateClient, useUpdateProject, useClients, useProjects } from '../../hooks/useQueries';
import { useT } from '../../lib/i18n';
import './OrphanedRecordsModal.css';

interface OrphanedRecordsModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'clients' | 'projects';
}

export function OrphanedRecordsModal({ isOpen, onClose, type }: OrphanedRecordsModalProps) {
  const t = useT();
  const { data: profiles = [] } = useBusinessProfiles();
  // Fetch all clients/projects without profile filter (undefined) to see orphaned records
  const { data: allClients = [] } = useClients(undefined);
  const { data: allProjects = [] } = useProjects(undefined, undefined);
  const updateClientMutation = useUpdateClient();
  const updateProjectMutation = useUpdateProject();

  // Find orphaned records (those without profileId and not archived)
  const orphanedClients = useMemo(
    () => allClients.filter((c) => !c.profileId && !c.archivedAt),
    [allClients]
  );
  const orphanedProjects = useMemo(
    () => allProjects.filter((p) => !p.profileId && !p.archivedAt),
    [allProjects]
  );

  const orphanedRecords = type === 'clients' ? orphanedClients : orphanedProjects;

  // Local state for profile assignments (recordId -> profileId)
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const defaultProfile = profiles.find((p) => p.isDefault);

  const handleAssignmentChange = (recordId: string, profileId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [recordId]: profileId,
    }));
  };

  const handleAssignAllToDefault = async () => {
    if (!defaultProfile) return;

    try {
      if (type === 'clients') {
        for (const client of orphanedClients) {
          await updateClientMutation.mutateAsync({
            id: client.id,
            data: { profileId: defaultProfile.id },
          });
        }
      } else {
        for (const project of orphanedProjects) {
          await updateProjectMutation.mutateAsync({
            id: project.id,
            data: { profileId: defaultProfile.id },
          });
        }
      }
      onClose();
    } catch (error) {
      console.error('Failed to assign records to default profile:', error);
    }
  };

  const handleAssignIndividually = async () => {
    try {
      if (type === 'clients') {
        for (const client of orphanedClients) {
          const profileId = assignments[client.id] || defaultProfile?.id;
          if (profileId) {
            await updateClientMutation.mutateAsync({
              id: client.id,
              data: { profileId },
            });
          }
        }
      } else {
        for (const project of orphanedProjects) {
          const profileId = assignments[project.id] || defaultProfile?.id;
          if (profileId) {
            await updateProjectMutation.mutateAsync({
              id: project.id,
              data: { profileId },
            });
          }
        }
      }
      onClose();
    } catch (error) {
      console.error('Failed to assign records to profiles:', error);
    }
  };

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const isSubmitting = updateClientMutation.isPending || updateProjectMutation.isPending;

  if (!isOpen || !orphanedRecords.length) {
    return null;
  }

  return (
    <div className="orphaned-records-backdrop" onClick={handleBackdropClick}>
      <div className="orphaned-records-modal" role="dialog" aria-modal="true">
        <div className="orphaned-records-header">
          <h2>{t('orphanedRecords.title')}</h2>
          <p className="orphaned-records-description">
            {t(`orphanedRecords.description.${type}`)}
          </p>
        </div>

        <div className="orphaned-records-content">
          <div className="orphaned-records-quick-action">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAssignAllToDefault}
              disabled={isSubmitting || !defaultProfile}
              style={{ width: '100%' }}
            >
              {t('orphanedRecords.assignAllToDefault')}
              {defaultProfile && ` (${defaultProfile.name})`}
            </button>
          </div>

          <div className="orphaned-records-divider">
            <span>{t('orphanedRecords.or')}</span>
          </div>

          <div className="orphaned-records-list-section">
            <p className="orphaned-records-list-title">
              {t('orphanedRecords.assignIndividually')}
            </p>

            <div className="orphaned-records-table-container">
              <table className="orphaned-records-table">
                <thead>
                  <tr>
                    <th>{t(`common.${type === 'clients' ? 'client' : 'project'}`)}</th>
                    <th>{t('common.profile')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orphanedRecords.map((record) => (
                    <tr key={record.id}>
                      <td>{record.name}</td>
                      <td>
                        <select
                          className="select"
                          value={assignments[record.id] || defaultProfile?.id || ''}
                          onChange={(e) => handleAssignmentChange(record.id, e.target.value)}
                        >
                          {!assignments[record.id] && !defaultProfile && (
                            <option value="">{t('common.selectProfile')}</option>
                          )}
                          {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                              {profile.isDefault && ` (${t('common.default')})`}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="orphaned-records-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAssignIndividually}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
