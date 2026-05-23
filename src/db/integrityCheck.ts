/**
 * Data integrity checker.
 * Scans all tables for records that would be invisible to the UI:
 * - Missing profileId (orphaned records)
 * - Broken foreign key references (clientId/projectId pointing to non-existent records)
 */

import { db } from './database';

export interface OrphanedRecord {
  id: string;
  table: string;
  issue: string;
}

export interface BrokenReference {
  id: string;
  table: string;
  field: string;
  missingId: string;
}

export interface IntegrityResult {
  totalRecords: number;
  orphanedRecords: OrphanedRecord[];
  brokenReferences: BrokenReference[];
  isClean: boolean;
  error?: string;
}

/**
 * Run a full integrity check across all core tables.
 * Returns a structured result with all issues found.
 * Wrapped in try/catch to return partial results on error.
 */
export async function runIntegrityCheck(): Promise<IntegrityResult> {
  const orphanedRecords: OrphanedRecord[] = [];
  const brokenReferences: BrokenReference[] = [];
  let totalRecords = 0;

  try {
    // Load reference sets for FK checks
    const clientIds = new Set((await db.clients.toArray()).map(c => c.id));
    const projectIds = new Set((await db.projects.toArray()).map(p => p.id));

    // Check transactions
    const transactions = await db.transactions.toArray();
    totalRecords += transactions.length;
    for (const tx of transactions) {
      if (tx.deletedAt) continue;
      if (!tx.profileId) {
        orphanedRecords.push({ id: tx.id, table: 'transactions', issue: 'missing_profileId' });
      }
      if (tx.clientId && !clientIds.has(tx.clientId)) {
        brokenReferences.push({ id: tx.id, table: 'transactions', field: 'clientId', missingId: tx.clientId });
      }
      if (tx.projectId && !projectIds.has(tx.projectId)) {
        brokenReferences.push({ id: tx.id, table: 'transactions', field: 'projectId', missingId: tx.projectId });
      }
    }

    // Check expenses
    const expenses = await db.expenses.toArray();
    totalRecords += expenses.length;
    for (const exp of expenses) {
      if (exp.deletedAt) continue;
      if (!exp.profileId) {
        orphanedRecords.push({ id: exp.id, table: 'expenses', issue: 'missing_profileId' });
      }
    }

    // Check projects
    const projects = await db.projects.toArray();
    totalRecords += projects.length;
    for (const proj of projects) {
      if (proj.archivedAt) continue;
      if (!proj.profileId) {
        orphanedRecords.push({ id: proj.id, table: 'projects', issue: 'missing_profileId' });
      }
      if (proj.clientId && !clientIds.has(proj.clientId)) {
        brokenReferences.push({ id: proj.id, table: 'projects', field: 'clientId', missingId: proj.clientId });
      }
    }

    // Check clients
    const clients = await db.clients.toArray();
    totalRecords += clients.length;
    for (const client of clients) {
      if (client.archivedAt) continue;
      if (!client.profileId) {
        orphanedRecords.push({ id: client.id, table: 'clients', issue: 'missing_profileId' });
      }
    }
  } catch (err) {
    return {
      totalRecords,
      orphanedRecords,
      brokenReferences,
      isClean: false,
      error: err instanceof Error ? err.message : 'Unknown error during integrity check',
    };
  }

  return {
    totalRecords,
    orphanedRecords,
    brokenReferences,
    isClean: orphanedRecords.length === 0 && brokenReferences.length === 0,
  };
}
