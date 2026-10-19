import { pathToFileURL } from 'node:url';
import { CURRENT_TERMS, TERMS_LOCALES, type CurrentTerms } from '../legal.js';

/**
 * MUT-324 (D11): `server/scripts/deploy.sh` runs this before releasing. The
 * server asks people to accept CURRENT_TERMS, so that exact text must already
 * be readable on the public site: release web first. Netlify answers every path
 * with the app shell, so the check reads the build's manifest
 * (`/legal/terms-versions.json`, src/content/legal/termsManifest.ts), never a page.
 *
 * MUTABA3A_PUBLIC_ORIGIN names the site; its default is vite.config.ts's
 * DEFAULT_PUBLIC_ORIGIN (pinned by scripts/__tests__/legal-terms.test.ts; MUT-326
 * moves both to one origin config).
 */
export const DEFAULT_PUBLIC_ORIGIN = 'https://mutaba3a.netlify.app';
const MANIFEST_PATH = '/legal/terms-versions.json';
const TIMEOUT_MS = 15_000;

/** Null when the site lists `terms` with the same text fingerprints; otherwise what is wrong. */
export function termsLiveProblem(manifest: unknown, terms: CurrentTerms): string | null {
  const versions = (manifest as { versions?: unknown } | null)?.versions;
  if (!Array.isArray(versions)) return 'the public site answered with something that is not a terms manifest';
  const live = versions.find((v): v is { version: string; sha256: Record<string, string> } => (v as { version?: unknown })?.version === terms.version);
  if (!live) return `terms ${terms.version} is not live on the public site yet: release web first`;
  for (const locale of TERMS_LOCALES) {
    if (live.sha256?.[locale] !== terms.sha256[locale]) return `terms ${terms.version}: the live ${locale} text differs from the one this release fingerprints`;
  }
  return null;
}

async function main(): Promise<number> {
  const origin = (process.env.MUTABA3A_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN).replace(/\/$/, '');
  const url = `${origin}${MANIFEST_PATH}`;
  let manifest: unknown;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    manifest = res.ok ? await res.json() : null;
  } catch {
    manifest = null;
  }
  const problem = termsLiveProblem(manifest, CURRENT_TERMS);
  if (problem) {
    console.error(`[terms] ${problem} (${url})`);
    return 1;
  }
  console.log(`[terms] ${CURRENT_TERMS.version} is live at ${origin}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main().then((code) => process.exit(code));
}
