// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import raw from '../../config/hosts.json';
import { parseHostsConfig } from '../../config/hosts';
import { CIMD_CLIENT_ID } from '../../src/services/oauth/oauth-client';

/**
 * MUT-326 AC1 (ADR-155): our public hosts live in config/hosts.json and nowhere else,
 * so choosing the domain is one edit. Code, tests, scripts, Terraform and CI read the
 * config (config/hosts.ts, `npm run hosts -- get …`, Terraform's hosts_file); prose
 * (Markdown and the .claude/ knowledge files) may name hosts freely.
 */
const CONFIG_FILE = 'config/hosts.json';
const PROSE = [/\.md$/, /^\.claude\//, /^docs\//];
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|otf|ttf|woff2?|pdf|zip|gz|mp4|mov|webm|lockb|db|sqlite)$/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The Malafat OAuth client identity (CIMD_CLIENT_ID) is a fixed literal on its own host
 * (MUT-387, ADR-155 amendment): it must not move with a future domain change, so these files
 * may name the chosen domain. cimd-document.test.ts pins the literal to the published document.
 */
const OWN_VALUE_FILES = new Set([
  'public/.well-known/oauth-client.json',
  'src/services/oauth/oauth-client.ts',
]);

/** Hosts we never owned and must never name again (MUT-387): mutaba3a.app has no DNS and no registrant. */
const RETIRED_HOSTS = ['mutaba3a.app'];
const THIS_FILE = 'scripts/__tests__/no-hardcoded-hosts.test.ts';
/**
 * MUT-359 (D7): the one file that names a retired host in order to refuse it. The mailer never sends there and config
 * refuses it as a sender or reply-to; tests read the value from UNOWNED_DOMAINS instead of spelling it.
 */
const RETIRED_HOST_REFUSERS = new Set(['server/src/email/ports.ts']);

/** Every host the config names, plus any Mutaba3a Cloud Run or Netlify host (a new service URL must go through the config too). */
const hostPattern = (host: string) => new RegExp(`(?<![a-z0-9-])${escape(host)}(?![a-z0-9-])`, 'i');

/** The legacy hosts the config names, plus any Mutaba3a Cloud Run or Netlify host (a new service URL must go through the config too). */
function legacyPatterns(config: unknown): RegExp[] {
  const hosts = Object.values(parseHostsConfig(config)).flatMap((env) => [new URL(env.legacy.landing).hostname, new URL(env.legacy.portal).hostname]);
  return [...new Set(hosts)].map(hostPattern).concat(/mutaba3a[a-z0-9-]*\.(?:a\.run\.app|netlify\.app)/i);
}

/** The chosen domains (and every subdomain of them). */
function domainPatterns(config: unknown): RegExp[] {
  return Object.values(parseHostsConfig(config)).flatMap((env) => (env.domain ? [hostPattern(env.domain)] : []));
}

function forbiddenPatterns(config: unknown): RegExp[] {
  return [...legacyPatterns(config), ...domainPatterns(config)];
}

export function hardcodedHosts(text: string, patterns: RegExp[]): string[] {
  return text.split('\n').flatMap((line, i) =>
    patterns.some((p) => p.test(line)) ? [`${i + 1}: ${line.trim().slice(0, 160)}`] : [],
  );
}

function scannedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((file) => file !== CONFIG_FILE && !BINARY.test(file) && !PROSE.some((p) => p.test(file)));
}

describe('no hardcoded hosts (MUT-326)', () => {
  it('catches a planted literal, a new run.app service and a chosen domain', () => {
    const planted = forbiddenPatterns({
      production: { domain: 'placeholder.example', portalSubdomain: 'app', stage: 'live', legacy: { landing: 'https://old.example', portal: 'https://portal.old.example' } },
    });
    expect(hardcodedHosts('const a = "https://old.example/terms";', planted)).toHaveLength(1);
    expect(hardcodedHosts('fetch("https://app.placeholder.example/v1")', planted)).toHaveLength(1);
    expect(hardcodedHosts(`url: https://mutaba3a-${'worker-abc123-ew'}.a.run.app`, planted)).toHaveLength(1);
    expect(hardcodedHosts('const ok = "https://notplaceholder.example";', planted)).toEqual([]);
    expect(hardcodedHosts('const ok = "https://example.a.run.app";', planted)).toEqual([]);
  });

  /** Every scanned file's hits, each file checked against the patterns `patternsFor` picks for it. */
  function findings(patternsFor: (file: string) => RegExp[]): string[] {
    return scannedFiles().flatMap((file) => {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        return []; // deleted in the working tree
      }
      return hardcodedHosts(text, patternsFor(file)).map((hit) => `${file}:${hit}`);
    });
  }

  it('finds our hosts in no code, test, script, Terraform or CI file outside config/hosts.json', () => {
    const legacy = legacyPatterns(raw);
    const all = [...legacy, ...domainPatterns(raw)];
    expect(findings((file) => (OWN_VALUE_FILES.has(file) ? legacy : all)), 'read the host from config/hosts.ts, `npm run hosts -- get`, or Terraform var.hosts_file').toEqual([]);
  });

  it('names no retired host in any code, test, script, Terraform or CI file, own-value files included', () => {
    const retired = RETIRED_HOSTS.map(hostPattern);
    expect(findings((file) => (file === THIS_FILE || RETIRED_HOST_REFUSERS.has(file) ? [] : retired))).toEqual([]);
  });

  it('lets the refusal list name each retired host and nothing else does it for them', () => {
    const source = readFileSync('server/src/email/ports.ts', 'utf8');
    for (const host of RETIRED_HOSTS) expect(source).toMatch(new RegExp(`UNOWNED_DOMAINS[^\\n]*'${escape(host)}'`));
  });

  it('keeps the OAuth client identity on the configured apex, so a domain move must decide its fate (MUT-387)', () => {
    // The identity is a fixed literal, but Netlify serves it only while its host is the site's
    // primary domain, and Terraform builds that binding from this config.
    const message =
      'Moving the apex? Keep the OAuth client identity host bound to the Netlify site (alias) with its zone, ' +
      'per server/DEPLOYMENT.md §5a "What doesn\'t move", then update this check';
    expect(raw.production.domain, message).toBe(new URL(CIMD_CLIENT_ID).hostname);
  });
});
