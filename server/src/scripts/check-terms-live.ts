import { pathToFileURL } from 'node:url';
import { CURRENT_TERMS, TERMS_LOCALES, type CurrentTerms } from '../legal.js';

/**
 * MUT-324 (D11): the server release preflight (`scripts/preflight.sh server`)
 * runs this before the version bump, and `server/scripts/deploy.sh` again when
 * it is run on its own. The
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

/**
 * Null when `url`'s manifest lists `terms`; otherwise what is wrong. A fetch that fails says
 * how (the HTTP status or the error), so an outage never reads as "release web first".
 */
export async function checkTermsLive(url: string, terms: CurrentTerms, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return `could not fetch the terms manifest: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!res.ok) return `the public site answered HTTP ${res.status} for the terms manifest`;
  let manifest: unknown;
  try {
    manifest = await res.json();
  } catch {
    return 'the public site answered with something that is not JSON, so not a terms manifest';
  }
  return termsLiveProblem(manifest, terms);
}

async function main(): Promise<number> {
  const origin = (process.env.MUTABA3A_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN).replace(/\/$/, '');
  const url = `${origin}${MANIFEST_PATH}`;
  const problem = await checkTermsLive(url, CURRENT_TERMS);
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
