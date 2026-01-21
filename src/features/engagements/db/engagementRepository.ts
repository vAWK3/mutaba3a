import { db } from '../../../db/database';
import type {
  Engagement,
  EngagementVersion,
  EngagementDisplay,
  EngagementFilters,
  EngagementSnapshot,
  EngagementStatus,
} from '../types';

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

// ============================================================================
// Engagement Repository
// ============================================================================

export const engagementRepo = {
  /**
   * List engagements with display enrichment
   */
  async list(filters: EngagementFilters = {}): Promise<EngagementDisplay[]> {
    const engagements = await db.engagements.toArray();
    const versions = await db.engagementVersions.toArray();
    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const profiles = await db.businessProfiles.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const profileMap = new Map(profiles.map((p) => [p.id, p.name]));

    // Group versions by engagement
    const versionsByEngagement = new Map<string, EngagementVersion[]>();
    versions.forEach((v) => {
      const list = versionsByEngagement.get(v.engagementId) || [];
      list.push(v);
      versionsByEngagement.set(v.engagementId, list);
    });

    let filtered = engagements.filter((e) => {
      // Exclude archived unless explicitly included
      if (!filters.includeArchived && e.archivedAt) return false;

      // Apply filters
      if (filters.profileId && e.profileId !== filters.profileId) return false;
      if (filters.clientId && e.clientId !== filters.clientId) return false;
      if (filters.projectId && e.projectId !== filters.projectId) return false;
      if (filters.type && e.type !== filters.type) return false;
      if (filters.status && e.status !== filters.status) return false;
      if (filters.category && e.category !== filters.category) return false;

      // Search by client name or title from latest version
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const clientName = clientMap.get(e.clientId) || '';
        const engagementVersions = versionsByEngagement.get(e.id) || [];
        const latestVersion = engagementVersions.sort(
          (a, b) => b.versionNumber - a.versionNumber
        )[0];
        const title = latestVersion?.snapshot?.title || '';

        const matchesSearch =
          clientName.toLowerCase().includes(searchLower) ||
          title.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      return true;
    });

    // Sort by createdAt desc (most recent first)
    const sortBy = filters.sort?.by || 'createdAt';
    const sortDir = filters.sort?.dir || 'desc';
    filtered.sort((a, b) => {
      const aValue = (a as unknown as Record<string, unknown>)[sortBy] as string;
      const bValue = (b as unknown as Record<string, unknown>)[sortBy] as string;
      const comparison = aValue.localeCompare(bValue);
      return sortDir === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    if (filters.offset) {
      filtered = filtered.slice(filters.offset);
    }
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    // Enrich with display data
    return filtered.map((e) => {
      const engagementVersions = versionsByEngagement.get(e.id) || [];
      const latestVersion = engagementVersions.sort(
        (a, b) => b.versionNumber - a.versionNumber
      )[0];

      return {
        ...e,
        profileName: profileMap.get(e.profileId),
        clientName: clientMap.get(e.clientId),
        projectName: e.projectId ? projectMap.get(e.projectId) : undefined,
        title: latestVersion?.snapshot?.title,
        versionCount: engagementVersions.length,
        lastVersionAt: latestVersion?.createdAt,
      };
    });
  },

  /**
   * Get a single engagement by ID
   */
  async get(id: string): Promise<Engagement | undefined> {
    return db.engagements.get(id);
  },

  /**
   * Get engagement with display enrichment
   */
  async getDisplay(id: string): Promise<EngagementDisplay | undefined> {
    const engagement = await this.get(id);
    if (!engagement) return undefined;

    const profile = await db.businessProfiles.get(engagement.profileId);
    const client = await db.clients.get(engagement.clientId);
    const project = engagement.projectId
      ? await db.projects.get(engagement.projectId)
      : undefined;
    const versions = await this.getVersions(id);
    const latestVersion = versions.sort(
      (a, b) => b.versionNumber - a.versionNumber
    )[0];

    return {
      ...engagement,
      profileName: profile?.name,
      clientName: client?.name,
      projectName: project?.name,
      title: latestVersion?.snapshot?.title,
      versionCount: versions.length,
      lastVersionAt: latestVersion?.createdAt,
    };
  },

  /**
   * Create a new engagement
   */
  async create(
    data: Omit<Engagement, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Engagement> {
    const now = nowISO();
    const engagement: Engagement = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.engagements.add(engagement);
    return engagement;
  },

  /**
   * Update an engagement
   */
  async update(id: string, data: Partial<Engagement>): Promise<void> {
    await db.engagements.update(id, { ...data, updatedAt: nowISO() });
  },

  /**
   * Archive an engagement (soft delete)
   */
  async archive(id: string): Promise<void> {
    await db.engagements.update(id, {
      archivedAt: nowISO(),
      updatedAt: nowISO(),
      status: 'archived' as EngagementStatus,
    });
  },

  /**
   * Restore an archived engagement
   */
  async restore(id: string): Promise<void> {
    await db.engagements.update(id, {
      archivedAt: undefined,
      updatedAt: nowISO(),
      status: 'draft' as EngagementStatus,
    });
  },

  /**
   * Permanently delete an engagement and all its versions
   */
  async delete(id: string): Promise<void> {
    // Delete all versions first
    const versions = await this.getVersions(id);
    for (const version of versions) {
      await db.engagementVersions.delete(version.id);
    }
    // Delete the engagement
    await db.engagements.delete(id);
  },

  /**
   * Get all versions for an engagement
   */
  async getVersions(engagementId: string): Promise<EngagementVersion[]> {
    return db.engagementVersions
      .where('engagementId')
      .equals(engagementId)
      .toArray();
  },

  /**
   * Get a specific version
   */
  async getVersion(versionId: string): Promise<EngagementVersion | undefined> {
    return db.engagementVersions.get(versionId);
  },

  /**
   * Get the latest version for an engagement
   */
  async getLatestVersion(
    engagementId: string
  ): Promise<EngagementVersion | undefined> {
    const versions = await this.getVersions(engagementId);
    if (versions.length === 0) return undefined;
    return versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
  },

  /**
   * Save a new version (draft)
   */
  async saveVersion(
    engagementId: string,
    snapshot: EngagementSnapshot,
    status: 'draft' | 'final' = 'draft'
  ): Promise<EngagementVersion> {
    const now = nowISO();

    // Get the current max version number
    const existingVersions = await this.getVersions(engagementId);
    const maxVersionNumber =
      existingVersions.length > 0
        ? Math.max(...existingVersions.map((v) => v.versionNumber))
        : 0;

    const version: EngagementVersion = {
      id: generateId(),
      engagementId,
      versionNumber: maxVersionNumber + 1,
      status,
      snapshot,
      createdAt: now,
    };

    await db.engagementVersions.add(version);

    // Update engagement's currentVersionId
    await this.update(engagementId, {
      currentVersionId: version.id,
    });

    return version;
  },

  /**
   * Finalize an engagement (create final version, lock engagement)
   */
  async finalize(
    engagementId: string,
    snapshot: EngagementSnapshot
  ): Promise<EngagementVersion> {
    // Create a final version
    const version = await this.saveVersion(engagementId, snapshot, 'final');

    // Update engagement status to final
    await this.update(engagementId, {
      status: 'final' as EngagementStatus,
      currentVersionId: version.id,
    });

    return version;
  },

  /**
   * Duplicate an engagement (create a new draft from existing)
   */
  async duplicate(
    engagementId: string,
    newClientId?: string,
    newProfileId?: string
  ): Promise<Engagement> {
    const original = await this.get(engagementId);
    if (!original) throw new Error('Engagement not found');

    const latestVersion = await this.getLatestVersion(engagementId);
    if (!latestVersion) throw new Error('No version found');

    const profileId = newProfileId || original.profileId;
    const profile = await db.businessProfiles.get(profileId);

    // Create new engagement as draft
    const newEngagement = await this.create({
      profileId,
      clientId: newClientId || original.clientId,
      projectId: undefined, // Don't copy project
      type: original.type,
      category: original.category,
      primaryLanguage: original.primaryLanguage,
      status: 'draft',
    });

    // Create initial version with modified snapshot
    const newSnapshot: EngagementSnapshot = {
      ...latestVersion.snapshot,
      profileId,
      profileName: profile?.name || '',
      clientId: newClientId || original.clientId,
      projectId: undefined,
      projectName: undefined,
    };

    await this.saveVersion(newEngagement.id, newSnapshot, 'draft');

    return newEngagement;
  },

  /**
   * Get engagements for a specific profile
   */
  async getByProfile(profileId: string): Promise<EngagementDisplay[]> {
    return this.list({ profileId });
  },

  /**
   * Get engagements for a specific client
   */
  async getByClient(clientId: string): Promise<EngagementDisplay[]> {
    return this.list({ clientId });
  },

  /**
   * Get engagements for a specific project
   */
  async getByProject(projectId: string): Promise<EngagementDisplay[]> {
    return this.list({ projectId });
  },

  /**
   * Count engagements by status
   */
  async countByStatus(): Promise<Record<EngagementStatus, number>> {
    const engagements = await db.engagements.toArray();
    const counts: Record<EngagementStatus, number> = {
      draft: 0,
      final: 0,
      archived: 0,
    };

    for (const e of engagements) {
      counts[e.status]++;
    }

    return counts;
  },
};
