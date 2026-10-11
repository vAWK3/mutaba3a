import { useMemo, useState, type ReactNode } from 'react';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import { useToast } from '../../lib/toastStore';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { useOrphanedRecords, useAssignOrphanedRecords, type OrphanAssignment } from '../../hooks/useOrphanedRecords';
import { startingProfileId, type OrphanTable, type OrphanedRecordSet } from '../../db/orphanedRecords';
import { formatAmount, formatDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { BusinessProfile, Currency } from '../../types';

const GROUP_ORDER: readonly OrphanTable[] = ['clients', 'projects', 'transactions', 'expenses'];
const NO_PROFILES: BusinessProfile[] = [];

interface OrphanRow {
  key: string;
  table: OrphanTable;
  id: string;
  label: string;
  /** Client of a project, or of an income entry that has its own title */
  clientName?: string;
  date?: string;
  amount?: { minor: number; currency: Currency };
  /** Profile of the linked client/project; undefined → the default profile */
  linkedProfileId?: string;
}

interface RowLabels {
  untitledIncome: string;
  untitledExpense: string;
}

function shapeRows(records: OrphanedRecordSet, selectable: ReadonlySet<string>, labels: RowLabels): OrphanRow[] {
  const nameOf = (clientId?: string) => (clientId ? records.clientNames[clientId] : undefined);
  const row = (table: OrphanTable, id: string, fields: Omit<OrphanRow, 'key' | 'table' | 'id'>): OrphanRow => ({
    key: `${table}:${id}`,
    table,
    id,
    ...fields,
  });

  return [
    ...records.clients.map((c) => row('clients', c.id, { label: c.name })),
    ...records.projects.map((p) =>
      row('projects', p.id, {
        label: p.name,
        clientName: nameOf(p.clientId),
        linkedProfileId: startingProfileId('projects', p, records, selectable),
      }),
    ),
    ...records.transactions.map((tx) =>
      row('transactions', tx.id, {
        label: tx.title || nameOf(tx.clientId) || labels.untitledIncome,
        clientName: tx.title ? nameOf(tx.clientId) : undefined,
        date: tx.occurredAt,
        amount: { minor: tx.amountMinor, currency: tx.currency },
        linkedProfileId: startingProfileId('transactions', tx, records, selectable),
      }),
    ),
    ...records.expenses.map((e) =>
      row('expenses', e.id, {
        label: e.title || e.vendor || labels.untitledExpense,
        date: e.occurredAt,
        amount: { minor: e.amountMinor, currency: e.currency },
        linkedProfileId: startingProfileId('expenses', e, records, selectable),
      }),
    ),
  ];
}

/**
 * Lists every record without a business profile (the ones the
 * orphaned-records banner counts) and assigns them, all at once or row by row.
 * Opened in place from the banner's "Review now".
 */
export function OrphanedRecordsDrawer() {
  const t = useT();
  const { showToast } = useToast();
  const { closeOrphanedRecordsDrawer } = useDrawerStore();
  const { data: records, isLoading: recordsLoading } = useOrphanedRecords();
  const { data: profiles = NO_PROFILES, isLoading: profilesLoading } = useBusinessProfiles();
  const assignMutation = useAssignOrphanedRecords();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [failedCount, setFailedCount] = useState(0);

  const defaultProfile = profiles.find((p) => p.isDefault) ?? profiles[0];
  const rows = useMemo(
    () =>
      records
        ? shapeRows(records, new Set(profiles.map((p) => p.id)), {
            untitledIncome: t('orphanedRecords.untitledIncome'),
            untitledExpense: t('orphanedRecords.untitledExpense'),
          })
        : [],
    [records, profiles, t],
  );

  if (recordsLoading || profilesLoading) {
    return (
      <Drawer title={t('orphanedRecords.title')} onClose={closeOrphanedRecordsDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  const canChoose = profiles.length > 1;
  const isSubmitting = assignMutation.isPending;
  const profileFor = (row: OrphanRow) => choices[row.key] ?? row.linkedProfileId ?? defaultProfile?.id ?? '';

  const assign = async (assignments: OrphanAssignment[]) => {
    setFailedCount(0);
    try {
      const { assigned, failedIds } = await assignMutation.mutateAsync(assignments);
      if (failedIds.length > 0) {
        setFailedCount(failedIds.length);
        return;
      }
      const message = assigned === 1 ? 'orphanedRecords.assignedSingular' : 'orphanedRecords.assignedPlural';
      showToast(t(message, { count: assigned }), { type: 'success' });
      closeOrphanedRecordsDrawer();
    } catch (error) {
      console.error('Failed to assign records to profiles:', error);
      setFailedCount(assignments.length);
    }
  };

  const assignAllTo = (profile: BusinessProfile) =>
    assign(rows.map(({ table, id }) => ({ table, id, profileId: profile.id })));
  const assignAsChosen = () => assign(rows.map((row) => ({ table: row.table, id: row.id, profileId: profileFor(row) })));

  const actions = rows.length > 0 && defaultProfile
    ? { profile: defaultProfile, label: t('orphanedRecords.assignAllTo', { profile: defaultProfile.name }) }
    : undefined;

  return (
    <Drawer
      title={t('orphanedRecords.title')}
      onClose={closeOrphanedRecordsDrawer}
      footer={
        <>
          <div className="drawer-footer-left" />
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeOrphanedRecordsDrawer}>
              {actions ? t('common.cancel') : t('common.close')}
            </button>
            {actions && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={canChoose ? assignAsChosen : () => assignAllTo(actions.profile)}
                disabled={isSubmitting}
              >
                {isSubmitting ? t('common.saving') : canChoose ? t('common.save') : actions.label}
              </button>
            )}
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="orphaned-records-intro">{t('orphanedRecords.allAssigned')}</p>
      ) : (
        <>
          <p className="orphaned-records-intro">
            {t(canChoose ? 'orphanedRecords.description' : 'orphanedRecords.descriptionSingleProfile')}
          </p>
          {!defaultProfile && <p className="orphaned-records-notice">{t('orphanedRecords.noProfiles')}</p>}
          {failedCount > 0 && (
            <p className="orphaned-records-notice orphaned-records-notice-error" role="alert">
              {t(failedCount === 1 ? 'orphanedRecords.partialFailureSingular' : 'orphanedRecords.partialFailurePlural', {
                count: failedCount,
              })}
            </p>
          )}
          {actions && canChoose && (
            <button
              type="button"
              className="btn btn-secondary orphaned-records-assign-all"
              onClick={() => assignAllTo(actions.profile)}
              disabled={isSubmitting}
            >
              {actions.label}
            </button>
          )}
          {GROUP_ORDER.map((table) => (
            <OrphanGroup
              key={table}
              table={table}
              rows={rows.filter((row) => row.table === table)}
              profiles={actions && canChoose ? profiles : undefined}
              profileFor={profileFor}
              onChoose={(row, profileId) => setChoices((prev) => ({ ...prev, [row.key]: profileId }))}
              disabled={isSubmitting}
            />
          ))}
        </>
      )}
    </Drawer>
  );
}

interface OrphanGroupProps {
  table: OrphanTable;
  rows: OrphanRow[];
  /** Offer a profile picker per row; omitted when there's only one profile to pick */
  profiles?: BusinessProfile[];
  profileFor: (row: OrphanRow) => string;
  onChoose: (row: OrphanRow, profileId: string) => void;
  disabled: boolean;
}

function OrphanGroup({ table, rows, profiles, profileFor, onChoose, disabled }: OrphanGroupProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  if (rows.length === 0) return null;

  return (
    <section className="orphaned-records-group">
      <h3 className="orphaned-records-group-title">{t(`orphanedRecords.groups.${table}`, { count: rows.length })}</h3>
      <ul className="orphaned-records-list">
        {rows.map((row) => (
          <li key={row.key} className="orphaned-records-row" data-testid={`orphan-row-${row.id}`}>
            <div className="orphaned-records-row-text">
              <span className="orphaned-records-row-label">{row.label}</span>
              <RowDetail row={row} locale={locale} />
            </div>
            {profiles && (
              <select
                className="select orphaned-records-row-select"
                aria-label={t('orphanedRecords.profileFor', { record: row.label })}
                value={profileFor(row)}
                onChange={(e) => onChoose(row, e.target.value)}
                disabled={disabled}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RowDetail({ row, locale }: { row: OrphanRow; locale: string }) {
  const parts: ReactNode[] = [];
  if (row.clientName) parts.push(row.clientName);
  if (row.date) parts.push(formatDate(row.date, locale));
  if (row.amount) parts.push(<bdi dir="ltr">{formatAmount(row.amount.minor, row.amount.currency, locale)}</bdi>);
  if (parts.length === 0) return null;

  return (
    <span className="orphaned-records-row-detail">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {part}
        </span>
      ))}
    </span>
  );
}
