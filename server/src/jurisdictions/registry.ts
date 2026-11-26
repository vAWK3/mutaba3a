import { DEFAULT_COUNTRY } from '../issuing/jurisdictions.js';
import { IL_PACK } from './il/index.js';
import type { JurisdictionPack } from './pack.js';

/**
 * MUT-741 (ADR-287): the packs by country. `issuing/jurisdictions.ts` (MUT-740) says which countries are LIVE on this
 * server; this says which have rules at all. A live country must have a pack (a test holds it).
 */
const PACKS = new Map<string, JurisdictionPack>([[IL_PACK.country, IL_PACK]]);

/** TESTS ONLY: stands a pack in for a country that has none yet (a route test of "a second live country"); returns its undo. */
export function registerPackForTests(pack: JurisdictionPack): () => void {
  PACKS.set(pack.country, pack);
  return () => void PACKS.delete(pack.country);
}

export function hasPack(country: string): boolean {
  return PACKS.has(country);
}

export function registeredCountries(): string[] {
  return [...PACKS.keys()];
}

/** The pack for a country; throws for one with no pack (the live-jurisdiction guard refuses those before they get here). */
export function packFor(country: string): JurisdictionPack {
  const pack = PACKS.get(country);
  if (!pack) throw new Error(`No jurisdiction pack for ${country}`);
  return pack;
}

/**
 * The pack for code that has no issuer in hand: the expense flags, a customer's tax number, retention of a document row.
 * That is Israel while it is the only pack; `boundary.test.ts` names every caller, and MUT-742/743 give each its country.
 */
export function defaultPack(): JurisdictionPack {
  return packFor(DEFAULT_COUNTRY);
}

/** Boot check (MUT-741): a country the server says is live must have rules, or it would be live for nothing. */
export function assertPacksFor(live: readonly string[]): void {
  const missing = live.filter((country) => !hasPack(country));
  if (missing.length > 0) throw new Error(`INVOICING_JURISDICTIONS lists ${missing.join(', ')}: no jurisdiction pack for ${missing.length > 1 ? 'them' : 'it'}`);
}
