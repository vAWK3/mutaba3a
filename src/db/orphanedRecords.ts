/**
 * Records saved without a business profile ("orphans").
 *
 * Every profile-scoped list filters by `profileId`, so these rows show up
 * nowhere. This module is the one definition of "unassigned": the banner's
 * count (`runIntegrityCheck`) and the drawer that fixes them
 * (`OrphanedRecordsDrawer`) both use `isOrphaned`, so they can't disagree.
 */

import { db } from './database';
import type { Client, Expense, Project, Transaction } from '../types';

export type OrphanTable = 'clients' | 'projects' | 'transactions' | 'expenses';

interface OrphanRecordByTable {
  clients: Client;
  projects: Project;
  transactions: Transaction;
  expenses: Expense;
}

/** Clients and projects leave the lists when archived; income and expenses when soft-deleted. */
export const isOrphaned = {
  clients: (c: Client) => !c.archivedAt && !c.profileId,
  projects: (p: Project) => !p.archivedAt && !p.profileId,
  transactions: (t: Transaction) => !t.deletedAt && !t.profileId,
  expenses: (e: Expense) => !e.deletedAt && !e.profileId,
} satisfies { [T in OrphanTable]: (record: OrphanRecordByTable[T]) => boolean };

export interface ProfileLinks {
  /** Profile of every client that has one */
  clientProfileIds: Record<string, string>;
  /** Profile of every project that has one */
  projectProfileIds: Record<string, string>;
}

export interface OrphanedRecordSet extends ProfileLinks {
  /** Name of every client, assigned or not, for labelling projects and untitled entries */
  clientNames: Record<string, string>;
  clients: Client[];
  projects: Project[];
  transactions: Transaction[];
  expenses: Expense[];
}

function profileIdsById(records: Array<{ id: string; profileId?: string }>): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const record of records) {
    if (record.profileId) ids[record.id] = record.profileId;
  }
  return ids;
}

/** The unassigned records of every kind, plus what `startingProfileId` needs to suggest a profile. */
export async function findOrphanedRecords(): Promise<OrphanedRecordSet> {
  const [clients, projects, transactions, expenses] = await Promise.all([
    db.clients.toArray(),
    db.projects.toArray(),
    db.transactions.toArray(),
    db.expenses.toArray(),
  ]);

  return {
    clients: clients.filter(isOrphaned.clients),
    projects: projects.filter(isOrphaned.projects),
    transactions: transactions.filter(isOrphaned.transactions),
    expenses: expenses.filter(isOrphaned.expenses),
    clientProfileIds: profileIdsById(clients),
    projectProfileIds: profileIdsById(projects),
    clientNames: Object.fromEntries(clients.map((c) => [c.id, c.name])),
  };
}

/**
 * The profile an unassigned record most likely belongs to: its client's, then
 * its project's (projects only have a client). A linked profile that isn't in
 * `selectable` (archived) is skipped. `undefined` means "use the default".
 */
export function startingProfileId<T extends OrphanTable>(
  table: T,
  record: OrphanRecordByTable[T],
  links: ProfileLinks,
  selectable: ReadonlySet<string>,
): string | undefined {
  if (table === 'clients') return undefined;

  const { clientId, projectId } = record as { clientId?: string; projectId?: string };
  const candidates = [
    clientId ? links.clientProfileIds[clientId] : undefined,
    table !== 'projects' && projectId ? links.projectProfileIds[projectId] : undefined,
  ];
  return candidates.find((id): id is string => !!id && selectable.has(id));
}
