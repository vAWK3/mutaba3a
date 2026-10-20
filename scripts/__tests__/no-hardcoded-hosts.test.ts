// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import raw from '../../config/hosts.json';
import { parseHostsConfig } from '../../config/hosts';

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
 * The Malafat OAuth client identity (CIMD_CLIENT_ID) stays on its own value whatever domain
 * is chosen (MUT-326 scope), so these files may name mutaba3a.app even if it becomes the domain.
 */
const OWN_VALUE_FILES = new Set([
  'public/.well-known/oauth-client.json',
  'src/services/oauth/oauth-client.ts',
  'src/services/oauth/__tests__/oauth-client.test.ts',
  'src/services/oauth/__tests__/cimd-document.test.ts',
  'scripts/bundle-origins.json',
  // This file names it for the rehearsal below.
  'scripts/__tests__/no-hardcoded-hosts.test.ts',
]);

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

  function findings(legacy: RegExp[], domains: RegExp[]): string[] {
    return scannedFiles().flatMap((file) => {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        return []; // deleted in the working tree
      }
      const filePatterns = OWN_VALUE_FILES.has(file) ? legacy : [...legacy, ...domains];
      return hardcodedHosts(text, filePatterns).map((hit) => `${file}:${hit}`);
    });
  }

  it('finds our hosts in no code, test, script, Terraform or CI file outside config/hosts.json', () => {
    expect(findings(legacyPatterns(raw), domainPatterns(raw)), 'read the host from config/hosts.ts, `npm run hosts -- get`, or Terraform var.hosts_file').toEqual([]);
  });

  it('would stay green on the day the likeliest domain (mutaba3a.app) is set', () => {
    const rehearsal = { ...raw, production: { ...raw.production, domain: 'mutaba3a.app', stage: 'live' } };
    expect(findings(legacyPatterns(rehearsal), domainPatterns(rehearsal))).toEqual([]);
  });
});
