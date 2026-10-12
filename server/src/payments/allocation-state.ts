import type { AllocationState, PaymentRecord } from '../repositories/ports.js';

/**
 * MUT-61: how much of a payment has been applied to receivables. The one
 * definition the memory store's filter, the Prisma filter's shape and the
 * payment view all follow. A REVERSED payment reads `unallocated` (its
 * allocations were undone); its `status` says why.
 */
export function allocationStateOf(p: Pick<PaymentRecord, 'amountMinor' | 'allocatedMinor'>): AllocationState {
  if (p.allocatedMinor <= 0n) return 'unallocated';
  return p.allocatedMinor < p.amountMinor ? 'partial' : 'allocated';
}
