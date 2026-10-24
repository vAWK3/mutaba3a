import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Me, type TrialPrompt, type TrialPromptAction } from '../api/client';
import { ME_KEY } from '../session/me';
import { optimisticTrialPrompt } from './trialPrompt';

/**
 * MUT-418: answer the first-run trial step, or hide the Home banner for 3 days. The cached /v1/me changes at once
 * (optimisticTrialPrompt), then takes the server's stored answer. On a failure the optimistic answer stays for this
 * visit: the step must not reopen under the person's hands, and the next /v1/me tells the truth again.
 */
export function useAnswerTrialPrompt() {
  const queryClient = useQueryClient();
  const write = (prompt: (current: TrialPrompt | undefined) => TrialPrompt) =>
    queryClient.setQueryData<Me>(ME_KEY, (current) => (current ? { ...current, user: { ...current.user, trialPrompt: prompt(current.user.trialPrompt) } } : current));
  return useMutation({
    mutationFn: (action: TrialPromptAction) => api.changeTrialPrompt(action),
    // A /v1/me refetch already in flight (focus, staleness) would land after the answer and undo it (review finding 4)
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      write((current) => optimisticTrialPrompt(current, action, new Date()));
    },
    onSuccess: (stored) => write(() => stored),
  });
}
