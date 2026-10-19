import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateProjectRequest, type Project } from '../api/client';
import { profileKey } from '../session/me';
import { useAttemptKey } from './attemptKey';

/**
 * Adding a matter from the matter picker (MUT-318), as useCreateCustomer adds a client (MUT-286). The Idempotency-Key
 * follows the attempt: picking Add for the same matter again after a lost response replays the first create. On
 * success every matter list (each client's, and the drawers' all-clients one) and the summaries refetch.
 */
export function useCreateProject(profileId: string) {
  const queryClient = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: (body: CreateProjectRequest): Promise<Project> => api.createProject(profileId, body, attempt.keyFor(body)),
    onSuccess: () => {
      attempt.succeeded();
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'directory', 'projects') });
      void queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'summary') });
    },
  });
}
