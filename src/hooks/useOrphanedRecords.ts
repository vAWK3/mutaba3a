import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRepositories } from '../db';
import { findOrphanedRecords, type OrphanTable } from '../db/orphanedRecords';

export const orphanedRecordsQueryKey = ['orphanedRecords'] as const;

export interface OrphanAssignment {
  table: OrphanTable;
  id: string;
  profileId: string;
}

export interface AssignResult {
  assigned: number;
  failedIds: string[];
}

export function useOrphanedRecords() {
  return useQuery({
    queryKey: orphanedRecordsQueryKey,
    queryFn: findOrphanedRecords,
  });
}

function assignOne({ table, id, profileId }: OrphanAssignment): Promise<void> {
  const repos = getRepositories().base;
  switch (table) {
    case 'clients':
      return repos.clients.update(id, { profileId });
    case 'projects':
      return repos.projects.update(id, { profileId });
    case 'transactions':
      return repos.transactions.update(id, { profileId });
    case 'expenses':
      return repos.expenses.update(id, { profileId });
  }
}

/**
 * Writes each record's profile one at a time, through the same `base`
 * repositories the entity drawers use. A row that fails (a transaction locked
 * by an exported document rejects the write) doesn't stop the rest; its id
 * comes back in `failedIds`. A profile change touches every profile-scoped
 * list, the summaries and the banner's count, so every query is refetched.
 */
export function useAssignOrphanedRecords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignments: OrphanAssignment[]): Promise<AssignResult> => {
      const failedIds: string[] = [];
      for (const assignment of assignments) {
        try {
          await assignOne(assignment);
        } catch (error) {
          console.error(`Failed to assign ${assignment.table}/${assignment.id} to a profile:`, error);
          failedIds.push(assignment.id);
        }
      }
      return { assigned: assignments.length - failedIds.length, failedIds };
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}
