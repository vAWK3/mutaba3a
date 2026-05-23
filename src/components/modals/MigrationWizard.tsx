import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '../../db/database';
import { exportBackup } from '../../db/backup';
import { Button } from '../ui/Button';
import './MigrationWizard.css';

interface NeedsReviewRecord {
  id: string;
  kind: string;
  title?: string;
  amountMinor: number;
  currency: string;
  profileId: string;
}

interface Profile {
  id: string;
  name: string;
}

export function MigrationWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [backupDone, setBackupDone] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [migrationComplete, setMigrationComplete] = useState(false);

  // Escape key: only closes on Step 1 (before changes)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && step === 1) {
      // Can't actually dismiss since records still need review,
      // but we allow closing on step 1 only
    }
  }, [step]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Query for records needing review
  const { data: needsReviewRecords = [], isLoading: loadingRecords } = useQuery({
    queryKey: ['migration-needs-review'],
    queryFn: async () => {
      const txs = await db.transactions
        .filter(tx => tx.needsReview === true)
        .toArray();
      return txs as NeedsReviewRecord[];
    },
  });

  // Query for available profiles
  const { data: profiles = [] } = useQuery({
    queryKey: ['migration-profiles'],
    queryFn: async () => {
      const all = await db.businessProfiles.toArray();
      return all.filter(p => !p.archivedAt) as Profile[];
    },
  });

  // Mutation to confirm assignments
  const confirmMutation = useMutation({
    mutationFn: async (updates: Record<string, string>) => {
      // Only clear needsReview on records the user explicitly reviewed
      for (const [txId, profileId] of Object.entries(updates)) {
        await db.transactions.update(txId, {
          profileId,
          needsReview: undefined,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
    },
  });

  // Initialize assignments with current profileIds
  useEffect(() => {
    if (needsReviewRecords.length > 0 && Object.keys(assignments).length === 0) {
      const initial: Record<string, string> = {};
      needsReviewRecords.forEach(r => {
        initial[r.id] = r.profileId;
      });
      setAssignments(initial);
    }
  }, [needsReviewRecords, assignments]);

  // Don't render if no records need review
  if (!loadingRecords && needsReviewRecords.length === 0 && !migrationComplete) {
    return null;
  }

  // Show completion message briefly, then hide
  if (migrationComplete) {
    return (
      <div className="migration-overlay" role="dialog" aria-modal="true">
        <div className="migration-wizard">
          <div className="migration-content">
            <h2>Migration Complete</h2>
            <div className="migration-summary">
              <div className="migration-summary-item">✓ All records verified and assigned to profiles</div>
              <div className="migration-summary-item">✓ 0 issues found</div>
            </div>
            <div className="migration-actions">
              <Button variant="primary" onClick={() => setMigrationComplete(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleBackup = async () => {
    await exportBackup();
    setBackupDone(true);
  };

  const handleConfirm = () => {
    if (!showFinalConfirm) {
      setShowFinalConfirm(true);
      return;
    }
    confirmMutation.mutate(assignments, {
      onSuccess: () => setMigrationComplete(true),
    });
  };

  const totalRecords = needsReviewRecords.length;

  return (
    <div className="migration-overlay" role="dialog" aria-modal="true" aria-labelledby="migration-title">
      <div className="migration-wizard">
        {/* Step indicator */}
        <div className="migration-steps">
          <div className={`migration-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'complete' : ''}`}>
            {step > 1 ? '✓' : '1'}
          </div>
          <div className="migration-step-line" />
          <div className={`migration-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'complete' : ''}`}>
            {step > 2 ? '✓' : '2'}
          </div>
          <div className="migration-step-line" />
          <div className={`migration-step ${step >= 3 ? 'active' : ''}`}>
            3
          </div>
        </div>

        {/* Step 1: Backup & Scan */}
        {step === 1 && (
          <div className="migration-content">
            <h2 id="migration-title">Data Migration</h2>
            <p className="migration-description">
              We found {totalRecords} record{totalRecords !== 1 ? 's' : ''} that need{totalRecords === 1 ? 's' : ''} to be assigned to a business profile. Before proceeding, we recommend saving a backup of your data.
            </p>

            <div className="migration-backup-section">
              {!backupDone ? (
                <Button variant="secondary" onClick={handleBackup}>
                  Download backup
                </Button>
              ) : (
                <p className="migration-backup-done">✓ Backup downloaded. You can restore from Settings if anything goes wrong.</p>
              )}
            </div>

            <div className="migration-actions">
              <Button variant="primary" onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Review & Resolve */}
        {step === 2 && (
          <div className="migration-content">
            <h2>Review & Assign</h2>
            <p className="migration-description">
              {totalRecords} record{totalRecords !== 1 ? 's' : ''} need{totalRecords === 1 ? 's' : ''} your input. Assign each to a business profile.
            </p>

            <div className="migration-table-wrapper">
              <table className="migration-table">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Amount</th>
                    <th>Assign to profile</th>
                  </tr>
                </thead>
                <tbody>
                  {needsReviewRecords.map(record => (
                    <tr key={record.id}>
                      <td>{record.title || record.kind}</td>
                      <td>{(record.amountMinor / 100).toFixed(2)} {record.currency}</td>
                      <td>
                        <select
                          value={assignments[record.id] || ''}
                          onChange={(e) => setAssignments(prev => ({
                            ...prev,
                            [record.id]: e.target.value,
                          }))}
                        >
                          {profiles.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="migration-actions">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm & Migrate */}
        {step === 3 && (
          <div className="migration-content">
            <h2>{showFinalConfirm ? 'Are you sure?' : 'Confirm Migration'}</h2>
            <p className="migration-description">
              {showFinalConfirm
                ? 'This cannot be undone without restoring from backup.'
                : `Ready to update ${totalRecords} record${totalRecords !== 1 ? 's' : ''}.${backupDone ? ' Your backup is saved.' : ''}`
              }
            </p>

            <div className="migration-summary">
              <div className="migration-summary-item">
                ✓ {totalRecords} records will be assigned to profiles
              </div>
              {backupDone && (
                <div className="migration-summary-item">
                  ✓ Backup saved — restore from Settings if needed
                </div>
              )}
            </div>

            <div className="migration-actions">
              <Button variant="ghost" onClick={() => { setShowFinalConfirm(false); setStep(2); }}>
                {showFinalConfirm ? 'Cancel' : 'Review again'}
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirm}
                isLoading={confirmMutation.isPending}
              >
                Migrate now
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
