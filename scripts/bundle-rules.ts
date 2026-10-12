/**
 * What the built bundles may and may not contain (hosted-portal.md §8,
 * MUT-43). Pure, so `check-bundles.test.ts` can prove each rule fires;
 * `check-bundles.ts` applies them to `dist-web`, `dist-desktop` and
 * `dist-hosted`.
 */

export interface Rule {
  name: string;
  pattern: RegExp;
}

export interface Finding {
  rule: string;
  match: string;
}

/**
 * The local builds (web, desktop) must carry nothing of the portal: no endpoint,
 * cookie or header. Nor anything of retired device sync (MUT-73, ADR-053): the
 * three exact strings below shipped with the bundle and pairing UI, and are
 * specific enough not to match a library's own "sync".
 */
export const LOCAL_RULES: Rule[] = [
  { name: 'profile header', pattern: /X-Mutaba3a-Profile/i },
  { name: 'identity endpoint', pattern: /\/v1\/me\b/ },
  { name: 'session endpoint', pattern: /\/v1\/sessions\b/ },
  { name: 'session cookie', pattern: /mut_session/ },
  { name: 'sync bundle extension', pattern: /\.msync\b/ },
  { name: 'sync server command', pattern: /start_sync_server/ },
  { name: 'sync bundle export', pattern: /Export Sync Bundle/ },
];

/**
 * The portal must hold no figure on the device (no IndexedDB, no Dexie, no
 * service worker) and offer no self-service account door, in either language.
 * `تسجيل` alone is allowed: `تسجيل الدخول` is "sign in".
 */
export const HOSTED_RULES: Rule[] = [
  { name: 'indexedDB', pattern: /indexedDB/i },
  { name: 'Dexie', pattern: /\bDexie\b/ },
  { name: 'service worker', pattern: /serviceWorker/ },
  { name: 'sign up', pattern: /\bsign[\s-]?up\b/i },
  { name: 'create account', pattern: /create (an )?account/i },
  { name: 'forgot', pattern: /\bforgot/i },
  { name: 'reset password', pattern: /reset (your )?password/i },
  { name: 'invite', pattern: /\binvit(e|ation)/i },
  { name: 'ar: create account', pattern: /إنشاء حساب/ },
  { name: 'ar: forgot', pattern: /نسيت/ },
  { name: 'ar: reset', pattern: /إعادة تعيين/ },
  { name: 'ar: invite', pattern: /دعوة/ },
  { name: 'ar: subscribe', pattern: /اشترك/ },
];

export function findForbidden(text: string, rules: Rule[]): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (match) findings.push({ rule: rule.name, match: match[0] });
  }
  return findings;
}

const ORIGIN = /\bhttps?:\/\/[a-z0-9.-]+(?::\d+)?/gi;

export function extractOrigins(text: string): Set<string> {
  return new Set([...text.matchAll(ORIGIN)].map((m) => m[0].toLowerCase()));
}

export function newOrigins(found: Set<string>, allowlist: string[]): string[] {
  const allowed = new Set(allowlist.map((o) => o.toLowerCase()));
  return [...found].filter((origin) => !allowed.has(origin)).sort();
}
