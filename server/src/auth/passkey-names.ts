import providersFile from './passkey-providers.json' with { type: 'json' };
import type { SessionKind } from './sessions.js';

/**
 * MUT-115 (DR8): a new passkey is named for the person, never asked: the provider its AAGUID names (a vendored copy
 * of the public community list), else the device it was added from. The person can rename it afterwards.
 */
export const PASSKEY_NAME_MAX = 64;
const NO_AAGUID = '00000000-0000-0000-0000-000000000000';

export interface ProviderList {
  source: string;
  updated: string;
  providers: Record<string, string>;
}

export const PASSKEY_PROVIDERS: ProviderList = providersFile;

export function providerName(aaguid: string, list: ProviderList = PASSKEY_PROVIDERS): string | null {
  const key = aaguid.toLowerCase();
  if (key === NO_AAGUID) return null;
  return list.providers[key] ?? null;
}

/** "<Browser> on <OS>" from a browser's User-Agent; "iPhone" for the app (DR8: the phone half adds passkeys on iOS only). */
export function deviceLabel(userAgent: string | null, sessionKind: SessionKind): string {
  if (sessionKind === 'device') return 'iPhone';
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Passkey';
}

/** The name a new passkey gets: provider, else device; " 2", " 3" … when the person already has one by that name. */
export function passkeyNameFor(aaguid: string, userAgent: string | null, sessionKind: SessionKind, taken: readonly string[]): string {
  const base = (providerName(aaguid) ?? deviceLabel(userAgent, sessionKind)).slice(0, PASSKEY_NAME_MAX);
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, PASSKEY_NAME_MAX - suffix.length)}${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}
