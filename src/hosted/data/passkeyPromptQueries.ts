import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Me, type PasskeyPrompt, type PasskeyPromptAction } from '../api/client';
import { ME_KEY } from '../session/me';
import { optimisticPasskeyPrompt } from './passkeyPrompt';

/**
 * MUT-370: Not now on the "Add a passkey" card. The cached /v1/me hides the card at once (optimisticPasskeyPrompt),
 * then takes the server's answer; the MUT-418 `useAnswerTrialPrompt` shape. On a failure the optimistic hide stays for
 * this visit, and the next /v1/me tells the truth again.
 */
export function useAnswerPasskeyPrompt() {
  const queryClient = useQueryClient();
  const write = (prompt: (current: PasskeyPrompt | null) => PasskeyPrompt | null) =>
    queryClient.setQueryData<Me>(ME_KEY, (current) => (current ? { ...current, user: { ...current.user, passkeyPrompt: prompt(current.user.passkeyPrompt ?? null) } } : current));
  return useMutation({
    mutationFn: (action: PasskeyPromptAction) => api.changePasskeyPrompt(action),
    // A /v1/me refetch already in flight would land after the answer and bring the card back (MUT-418 review finding 4)
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      write((current) => optimisticPasskeyPrompt(current, new Date()));
    },
    onSuccess: (stored) => write(() => stored),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  });
}
