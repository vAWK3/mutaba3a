import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
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
 * MUTABA3A_PUBLIC_ORIGIN names the site. The `terms:check-live` npm script fills it
 * from config/hosts.json (`npm run hosts -- get landingOrigin --env <MUTABA3A_ENVIRONMENT>`
 * at the repo root, MUT-326, MUT-347), the same value vite.config.ts builds the landing for;
 * this file lives in the image's build context, which never sees that config, so it takes no default.
 *
 * MUT-347: `--commit <sha>` checks the terms that commit names instead (deploy.sh's ROLLBACK_TO), read
 * with git from its `server/src/legal.ts`. The manifest is append-only, so an older version normally passes.
 */
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

/** The site to check, or null when the caller named none (run it through `npm run terms:check-live`). */
export function publicOrigin(env: NodeJS.ProcessEnv): string | null {
  const origin = env.MUTABA3A_PUBLIC_ORIGIN?.trim().replace(/\/$/, '');
  return origin ? origin : null;
}

/** Where CURRENT_TERMS lives, from the repo root. */
export const LEGAL_PATH = 'server/src/legal.ts';

/** A file's text at a commit, or null when the commit has no such file. Throws when the commit isn't in this clone. */
export type GitShow = (commit: string, path: string) => string | null;

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export const gitShow: GitShow = (commit, path) => {
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    throw new Error(`${commit} is not in this clone (git fetch --tags origin?)`);
  }
  try {
    git(['cat-file', '-e', `${commit}:${path}`]);
  } catch {
    return null;
  }
  return git(['show', `${commit}:${path}`]);
};

/**
 * The CURRENT_TERMS literal exactly as legal.ts has written it since MUT-324 (949e71d5). Strict on purpose: a
 * rollback must never check a version it half-read, so any other shape throws, and this checkout's own
 * legal.ts is parsed by the tests, so a shape change fails there before it reaches a rollback.
 */
const TERMS_LITERAL =
  /export const CURRENT_TERMS: CurrentTerms = \{\n {2}version: '(\d{4}-\d{2}-\d{2})',\n {2}sha256: \{\n {4}en: '([0-9a-f]{64})',\n {4}ar: '([0-9a-f]{64})',\n {2}\},\n\};/;

/** The terms a legal.ts names; null when it names none (from before MUT-324). */
export function parseCurrentTerms(source: string): CurrentTerms | null {
  if (!/\bCURRENT_TERMS\b/.test(source)) return null;
  const m = TERMS_LITERAL.exec(source);
  if (!m) throw new Error(`CURRENT_TERMS in ${LEGAL_PATH} no longer has the literal shape this check parses; update TERMS_LITERAL in check-terms-live.ts`);
  const [, version, en, ar] = m as unknown as [string, string, string, string];
  return { version, sha256: { en, ar } };
}

/** The terms `commit` names; null for a commit from before MUT-324. Throws when it can't tell. */
export function termsAtCommit(commit: string, show: GitShow = gitShow): CurrentTerms | null {
  const source = show(commit, LEGAL_PATH);
  return source === null ? null : parseCurrentTerms(source);
}

interface CliDeps {
  fetchImpl?: typeof fetch;
  termsAt?: (commit: string) => CurrentTerms | null;
  /** The success line (stdout). */
  out?: (line: string) => void;
  /** Every refusal (stderr). */
  err?: (line: string) => void;
}

/** The command line: `[--commit <sha>]`. 0 when the terms are live, 1 with the reason otherwise. */
export async function checkTermsCli(argv: string[], env: NodeJS.ProcessEnv, deps: CliDeps = {}): Promise<number> {
  const { fetchImpl = fetch, termsAt = termsAtCommit, out = (line: string) => console.log(line), err: log = (line: string) => console.error(line) } = deps;
  const { values } = parseArgs({ args: argv, options: { commit: { type: 'string' } } });
  const origin = publicOrigin(env);
  if (!origin) {
    log('[terms] MUTABA3A_PUBLIC_ORIGIN is not set; run `npm --prefix server run terms:check-live`, which reads it from config/hosts.json');
    return 1;
  }
  let terms: CurrentTerms = CURRENT_TERMS;
  let named = '';
  if (values.commit) {
    let atCommit: CurrentTerms | null;
    try {
      atCommit = termsAt(values.commit);
    } catch (error) {
      log(`[terms] ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    if (!atCommit) {
      log(`[terms] ${values.commit} names no terms (no CURRENT_TERMS in ${LEGAL_PATH}): expected for a release from before MUT-324, which asks no one to accept terms. Pass SKIP_TERMS_CHECK=1 to roll back to it.`);
      return 1;
    }
    terms = atCommit;
    named = ` (named by ${values.commit})`;
  }
  const url = `${origin}${MANIFEST_PATH}`;
  const problem = await checkTermsLive(url, terms, fetchImpl);
  if (problem) {
    log(`[terms] ${problem}${named} (${url})`);
    return 1;
  }
  out(`[terms] ${terms.version}${named} is live at ${origin}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void checkTermsCli(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
