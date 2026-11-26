import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ME_KEY } from '../session/me';
import { BILLING_KEY } from './billingQueries';

/**
 * MUT-731 (Basel Q5): choosing the active business on Starter. Refetches /v1/me and Billing, so the gate's answer, the
 * blocking dialog and Billing's Active business row agree.
 */
export function useChooseActiveBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) => api.setActiveBusinesses([organizationId]),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ME_KEY }), queryClient.invalidateQueries({ queryKey: BILLING_KEY })]),
  });
}
