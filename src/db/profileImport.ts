// ============================================================================
// Profile import (MUT-158, fixed inside MUT-145)
// ============================================================================
//
// Restores a v2 per-profile export (Settings → Export) into the database,
// either as a new business profile or merged into an existing one.
//
// Every row gets a fresh ID so an import never collides with what is already
// stored, and every reference follows its row: transactions point at the
// imported (or reused) client and project, everything points at the target
// profile, and retained documents (ADR-029) keep their links to the entries.
// Duplicates are detected inside the target profile only (clients by a
// non-empty email, projects by name): clients belong to one business
// (ADR-049), so an import never links one business's entries to another's.
//
// Merge adds data; it never rewrites the chosen profile's own fields.

import { db } from './database';
import type { BusinessProfile, Client, FxRate, Project, Transaction } from '../types';
import type { Document, DocumentSequence } from './retained/documentSchema';

type Row = Record<string, unknown>;

export interface ProfileExportFile {
  version: 2;
  profileId?: string;
  profile: Partial<BusinessProfile> & { id: string; name: string };
  clients?: Row[];
  projects?: Row[];
  transactions?: Row[];
  documents?: Row[];
  documentSequences?: Row[];
  fxRates?: Row[];
}

export type ProfileImportTarget =
  | { mode: 'create'; makeDefault: boolean }
  | { mode: 'merge'; profileId: string };

export interface ProfileImportResult {
  profiles: number;
  clients: number;
  projects: number;
  transactions: number;
}

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * The existing profile an export belongs to: same ID, or the same non-empty
 * email on both sides. Two profiles without an email never match (email is
 * optional since MUT-145).
 */
export function findMatchingProfile(
  profiles: BusinessProfile[],
  file: Pick<ProfileExportFile, 'profileId' | 'profile'>,
): BusinessProfile | undefined {
  const email = str(file.profile?.email);
  return profiles.find((p) => p.id === file.profileId || (email !== undefined && p.email === email));
}

/** Map an old ID through `map`; a reference to a row not in the file is dropped. */
function remap(map: Map<string, string>, id: unknown): string | undefined {
  return typeof id === 'string' ? map.get(id) : undefined;
}

export async function importProfileFile(file: ProfileExportFile, target: ProfileImportTarget): Promise<ProfileImportResult> {
  const result: ProfileImportResult = { profiles: 0, clients: 0, projects: 0, transactions: 0 };
  const tables = [db.businessProfiles, db.clients, db.projects, db.transactions, db.documents, db.documentSequences, db.fxRates];

  await db.transaction('rw', tables, async () => {
    const now = nowISO();
    let profileId: string;

    if (target.mode === 'create') {
      profileId = newId();
      await db.businessProfiles.add({
        ...(file.profile as BusinessProfile),
        id: profileId,
        isDefault: target.makeDefault,
        createdAt: now,
        updatedAt: now,
      });
      result.profiles = 1;
    } else {
      profileId = target.profileId;
    }

    const ownClients = await db.clients.filter((c) => c.profileId === profileId).toArray();
    const ownProjects = await db.projects.filter((p) => p.profileId === profileId).toArray();

    const clientIds = new Map<string, string>();
    for (const client of file.clients ?? []) {
      const email = str(client.email);
      const existing = email ? ownClients.find((c) => c.email === email) : undefined;
      if (existing) {
        clientIds.set(client.id as string, existing.id);
        continue;
      }
      const id = newId();
      clientIds.set(client.id as string, id);
      await db.clients.add({ ...(client as unknown as Client), id, profileId });
      result.clients++;
    }

    const projectIds = new Map<string, string>();
    for (const project of file.projects ?? []) {
      const existing = ownProjects.find((p) => p.name === project.name);
      if (existing) {
        projectIds.set(project.id as string, existing.id);
        continue;
      }
      const id = newId();
      projectIds.set(project.id as string, id);
      await db.projects.add({
        ...(project as unknown as Project),
        id,
        profileId,
        clientId: remap(clientIds, project.clientId),
      });
      result.projects++;
    }

    // Mint every ID up front: transactions and documents point at each other.
    const transactionIds = new Map<string, string>((file.transactions ?? []).map((tx) => [tx.id as string, newId()]));
    const documentIds = new Map<string, string>((file.documents ?? []).map((doc) => [doc.id as string, newId()]));

    for (const tx of file.transactions ?? []) {
      const row: Row = {
        ...tx,
        id: transactionIds.get(tx.id as string),
        profileId,
        clientId: remap(clientIds, tx.clientId),
        projectId: remap(projectIds, tx.projectId),
      };
      if ('linkedDocumentId' in tx) row.linkedDocumentId = remap(documentIds, tx.linkedDocumentId);
      await db.transactions.add(row as unknown as Transaction);
      result.transactions++;
    }

    for (const doc of file.documents ?? []) {
      await db.documents.add({
        ...(doc as Document),
        id: documentIds.get(doc.id as string) as string,
        businessProfileId: profileId,
        clientId: remap(clientIds, doc.clientId),
        linkedTransactionIds: Array.isArray(doc.linkedTransactionIds)
          ? doc.linkedTransactionIds.map((id) => transactionIds.get(id as string)).filter((id): id is string => !!id)
          : undefined,
      });
    }

    for (const sequence of file.documentSequences ?? []) {
      const id = `${profileId}:${String(sequence.documentType)}`;
      if (await db.documentSequences.get(id)) continue;
      await db.documentSequences.add({ ...(sequence as DocumentSequence), id, businessProfileId: profileId });
    }

    for (const rate of file.fxRates ?? []) {
      const duplicate = await db.fxRates
        .filter((r) => r.baseCurrency === rate.baseCurrency && r.quoteCurrency === rate.quoteCurrency && r.effectiveDate === rate.effectiveDate)
        .first();
      if (!duplicate) await db.fxRates.add({ ...(rate as unknown as FxRate), id: newId() });
    }
  });

  return result;
}
