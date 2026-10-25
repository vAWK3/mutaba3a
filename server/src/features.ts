import type { LedgerStore } from './repositories/ports.js';

/**
 * MUT-433 (ADR-196): per-user feature flags, granted only by the operator. The names are a closed set in code; the
 * column is plain text, so a new flag is a change here and needs no migration. Every flag is off until granted.
 *
 * `agent_access`: the person may connect their own AI agent over MCP (epic MUT-432).
 */
export const FEATURES = ['agent_access'] as const;
export type Feature = (typeof FEATURES)[number];

export function isFeature(name: string): name is Feature {
  return (FEATURES as readonly string[]).includes(name);
}

/**
 * Whether the person holds the feature now. Read from the store on every call, never cached, so a revoke is seen on
 * the very next request (MUT-433 D6; MUT-434 enforces it on every MCP call).
 */
export async function hasFeature(store: Pick<LedgerStore, 'features'>, userId: string, feature: Feature): Promise<boolean> {
  return (await store.features.activeFor(userId)).includes(feature);
}
