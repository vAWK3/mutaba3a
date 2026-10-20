/**
 * MUT-326 (ADR-155): the command-line face of config/hosts.json.
 *
 *   npm run --silent hosts -- get <landingOrigin|portalOrigin|domain> [--env production]
 *       One value, for shell scripts (scripts/preflight.sh, server/scripts/*.sh).
 *   npm run domain:plan [-- --domain <apex> [--stage proxy|live|redirect]] [--env production]
 *       The dry run: every place a host is used, its value now and with the domain set
 *       (at stage live unless --stage says otherwise). Without --domain it reports what
 *       the file names.
 */
import { pathToFileURL } from 'node:url';
import raw from '../config/hosts.json';
import { parseHostsConfig, resolveHosts, type HostsConfig, type ResolvedHosts, type Stage } from '../config/hosts';

const GET_KEYS = ['landingOrigin', 'portalOrigin', 'domain'] as const;

export function getValue(hosts: ResolvedHosts, key: string): string {
  if (!(GET_KEYS as readonly string[]).includes(key)) throw new Error(`unknown key ${JSON.stringify(key)}; use one of ${GET_KEYS.join(', ')}`);
  return hosts[key as (typeof GET_KEYS)[number]] ?? '';
}

/** `config` with `environment`'s domain and stage replaced (null clears both), validated like the file. */
export function withDomain(config: HostsConfig, environment: string, domain: string | null, stage: Stage = 'live'): HostsConfig {
  const env = config[environment];
  if (!env) throw new Error(`config/hosts.json: no "${environment}" environment`);
  return parseHostsConfig({ ...config, [environment]: { ...env, domain, stage: domain === null ? 'legacy' : stage } });
}

const host = (origin: string) => new URL(origin).hostname;

function row(name: string, before: string, after: string): string {
  return `  ${name.padEnd(34)} ${before === after ? `= ${after}` : `${before} → ${after}`}`;
}

function phoneLines(next: ResolvedHosts): string[] {
  const hosts = next.appLinkHosts;
  const fd = next.frontDoor!;
  return [
    '7. Phone (mutaba3a-flutter repo, its own release at stage live; keep every host below for at least one release)',
    '   .env (read by fastlane and `make run` through --dart-define-from-file):',
    `     MUTABA3A_API_BASE_URL=${fd.portalOrigin}`,
    `     MUTABA3A_PORTAL_BASE_URL=${fd.portalOrigin}`,
    `     MUTABA3A_PUBLIC_ORIGIN=https://${fd.landingHost}`,
    `   ios/Flutter/AssociatedDomains.xcconfig: MUTABA3A_LINK_HOST = ${hosts[0]}`,
    '   ios/Runner/Runner.entitlements com.apple.developer.associated-domains, one pair per host:',
    ...hosts.flatMap((h) => [`     applinks:${h}$(MUTABA3A_LINK_MODE)`, `     webcredentials:${h}$(MUTABA3A_LINK_MODE)`]),
    ...(next.domain ? [`     webcredentials:${next.domain}$(MUTABA3A_LINK_MODE)   (apex: MUT-115 passkeys; needs the apex AASA first)`] : []),
    '   android/app/src/main/AndroidManifest.xml App Links intent-filter, per host and per path (/p/.*/expenses.*, /p/.*/payments.*, /capture.*):',
    ...hosts.map((h) => `     android:host="${h}"`),
    '   android/app/src/main/res/values/strings.xml asset_statements:',
    `     [${hosts.map((h) => `{"include": "https://${h}/.well-known/assetlinks.json"}`).join(', ')}]`,
  ];
}

/** The dry run, as text: what each consumer reads now, and with `next`'s domain. */
export function domainPlan(now: ResolvedHosts, next: ResolvedHosts): string {
  if (!next.domain) {
    return [
      `No domain is set in config/hosts.json (${next.environment}): everything serves from the legacy hosts.`,
      row('landing', now.landingOrigin, next.landingOrigin),
      row('portal + API', now.portalOrigin, next.portalOrigin),
      'Preview a domain with: npm run domain:plan -- --domain <apex>',
      '',
    ].join('\n');
  }
  const fd = next.frontDoor!;
  const live = next.stage === 'live' || next.stage === 'redirect';
  const redirectRules = [
    ...(live ? [`${fd.landingHost}/app/* → ${next.legacy!.landingOrigin}/app (the free web app's data stays there)`] : []),
    ...(next.redirectLegacy ? [`${next.legacy!.landingOrigin} /, /download, /privacy, /terms* → ${next.landingOrigin}`] : []),
  ].join('; ') || 'none';
  return [
    `Mutaba3a hosts plan (${next.environment}): ${now.domain ?? 'no domain'} → ${next.domain}, stage ${next.stage}`,
    'Order and checks: server/DEPLOYMENT.md §5a. Nothing here is applied by this command.',
    '',
    '1. Web build (vite.config.ts; switches at stage live; shipped by `make release web` and, for the portal bundle, `make release server`)',
    row('DEFAULT_PUBLIC_ORIGIN', now.landingOrigin, next.landingOrigin),
    row('DEFAULT_PORTAL_URL', now.portalOrigin, next.portalOrigin),
    row('Netlify _redirects', 'none', redirectRules),
    `  bundle allowlist (check-bundles adds): ${next.allOrigins.join(', ')}`,
    '',
    '2. Server release guard (scripts/preflight.sh, server/scripts/deploy.sh)',
    row('MUTABA3A_PUBLIC_ORIGIN', now.landingOrigin, next.landingOrigin),
    '  terms:check-live reads <that>/legal/terms-versions.json: the apex must serve the landing before the server release.',
    '',
    '3. Cloud Run env (terraform: server/infrastructure/terraform/domain.tf, from stage proxy on, applied by deploy.sh)',
    row('PORTAL_ORIGIN', 'unset', fd.portalOrigin),
    row('FRONT_DOOR_TOKEN', 'unset', 'secret mutaba3a-api-front-door-token (frontdoor stack)'),
    row('PORTAL_LEGACY_REDIRECT', 'unset', next.redirectLegacy ? 'true' : 'unset (stage redirect only)'),
    row('TRUSTED_PROXY_HOPS', '1', '1 (the front door hands over the client IP itself)'),
    '',
    '4. Front door (terraform: server/infrastructure/frontdoor/, applied by the operator)',
    `  Cloudflare zone ${fd.zone}; SSL full (strict), always HTTPS, TLS ≥ 1.2`,
    `  ${fd.landingHost} CNAME apex-loadbalancer.netlify.com (flattened, DNS only; Netlify issues the certificate)`,
    `  www.${fd.landingHost} CNAME ${fd.netlifyHost} (DNS only)`,
    `  ${fd.portalHost} AAAA 100:: (proxied) + Worker route ${fd.portalHost}/* → ${fd.upstreamOrigin}`,
    `  Netlify site domain: ${fd.landingHost} (alias www.${fd.landingHost})`,
    '',
    '5. Sentry allowed origins (server/infrastructure/sentry, adds them itself)',
    `  ${next.allOrigins.join(', ')}`,
    '',
    '6. Uptime checks (MUT-328: local.public_portal_host in the terraform stack)',
    row('uptime host', host(now.portalOrigin), fd.portalHost),
    '',
    ...phoneLines(next),
    '',
    '8. Malafat (its own Secret Manager)',
    `  malafat-web-mutaba3a-api-url: ${now.portalOrigin} keeps answering /v1 for good; switching it to ${fd.portalOrigin} is optional.`,
    '',
  ].join('\n');
}

interface Writer {
  out: (s: string) => void;
  err: (s: string) => void;
}

const USAGE = 'usage: hosts get <landingOrigin|portalOrigin|domain> [--env <name>] | hosts plan [--domain <apex> [--stage proxy|live|redirect]] [--env <name>]\n';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

export function main(args: string[], config: HostsConfig, write: Writer): number {
  const [command, key] = args;
  const env = flag(args, '--env') ?? 'production';
  try {
    if (command === 'get' && key) {
      write.out(`${getValue(resolveHosts(config, env), key)}\n`);
      return 0;
    }
    if (command === 'plan') {
      const domain = flag(args, '--domain');
      const stage = (flag(args, '--stage') ?? 'live') as Stage;
      const now = resolveHosts(withDomain(config, env, null), env);
      const next = resolveHosts(domain ? withDomain(config, env, domain, stage) : config, env);
      write.out(domainPlan(now, next));
      return 0;
    }
  } catch (error) {
    write.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  write.err(USAGE);
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2), parseHostsConfig(raw), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
