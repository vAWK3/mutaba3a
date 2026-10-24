import type { CarryOverSource } from './protocol';

/**
 * What this build knows about the carry-over (MUT-291 §3.2), baked in by
 * vite.config.ts `carryOverBuild` from config/hosts.json: the old origins a
 * receiver accepts, and the new portal a sender sends to. Off (no sources, no
 * portal) before stage live, in the desktop build, and in Vitest unless a test
 * sets `globalThis.__CARRY_OVER__`.
 */
export interface CarryOverBuild {
  sources: Partial<Record<CarryOverSource, string>>;
  portalOrigin: string | null;
}

const OFF: CarryOverBuild = { sources: {}, portalOrigin: null };

export function carryOverBuild(): CarryOverBuild {
  return typeof __CARRY_OVER__ !== 'undefined' ? __CARRY_OVER__ : OFF;
}
