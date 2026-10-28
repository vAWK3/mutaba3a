import { validationError } from '../agreements/compose.js';
import type { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import type { AllocationError } from './allocate.js';

/** An allocation the engine refused, as the 422 every payment route answers: the reason, the receivable, and the figures. */
export function allocationFailure(e: AllocationError, currency: Currency): ApiError {
  const fmt = (m: bigint | undefined) => (m === undefined ? undefined : formatMoney({ minor: m, currency }));
  return validationError(e.reason, allocationMessage(e.reason), {
    ...(e.receivableId ? { receivableId: e.receivableId } : {}),
    ...(e.outstandingMinor !== undefined ? { outstanding: fmt(e.outstandingMinor) } : {}),
    ...(e.excessMinor !== undefined ? { excess: fmt(e.excessMinor) } : {}),
  });
}

function allocationMessage(reason: string): string {
  switch (reason) {
    case 'ALLOCATION_EXCEEDS_PAYMENT':
      return 'Allocations add up to more than the amount available';
    case 'ALLOCATION_EXCEEDS_OUTSTANDING':
      return 'An allocation exceeds what is outstanding on its receivable';
    case 'ALLOCATION_DUPLICATE':
      return 'A receivable appears twice in the allocations';
    case 'RECEIVABLE_NOT_FOUND':
      return 'An allocation names a receivable this organization does not have';
    case 'RECEIVABLE_NOT_OPEN':
      return 'An allocation names a receivable with nothing outstanding';
    case 'RECEIVABLE_CUSTOMER_MISMATCH':
      return 'An allocation names another customer’s receivable';
    case 'CURRENCY_MISMATCH':
      return 'An allocation names a receivable in another currency; money is never converted';
    default:
      return 'Allocations are invalid';
  }
}
