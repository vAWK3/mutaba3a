import type { UsageEventInput, UsageStamp } from '../repositories/ports.js';
import { assertDetail, type UsageKind } from './kinds.js';
import { usageMonthOf } from './month.js';

/** MUT-735 (ADR-281): one usage event from a stamp, its detail checked against the kind's closed vocabulary. Pure. */
export function usageEvent(stamp: UsageStamp, what: { kind: UsageKind; detail: string | null; entityKey: string; organizationId: string | null }, at: Date): UsageEventInput {
  assertDetail(what.kind, what.detail);
  return { ...stamp, ...what, occurredAt: at, month: usageMonthOf(at) };
}
