/**
 * MUT-326 (ADR-155): Mutaba3a's public hosts, from the one file that names them
 * (`config/hosts.json`). The landing lives on the apex domain, the portal and API on
 * `<portalSubdomain>.<apex>`; the legacy hosts keep answering after the move.
 *
 * `stage` separates "the domain is known" from "the domain is live", so committing a
 * domain never re-points a release before its DNS works (server/DEPLOYMENT.md §5a):
 *
 *   legacy    no domain; everything on the legacy hosts
 *   proxy     the front door exists (Terraform keys on `domain`); builds still use the legacy hosts
 *   live      builds, links and the phone use the new hosts
 *   redirect  old-host pages are sent on too (only once the carry-over has shipped)
 *
 * Terraform repeats the derivation in server/infrastructure/{terraform/domain.tf,
 * frontdoor/hosts.tf,sentry/main.tf}; both sides are tested against config/fixtures/.
 */
import raw from './hosts.json';

export const STAGES = ['legacy', 'proxy', 'live', 'redirect'] as const;
export type Stage = (typeof STAGES)[number];

export interface LegacyOrigins {
  landing: string;
  portal: string;
  /**
   * MUT-487 (ADR-232, AM11): where the front door (the Cloudflare Worker) sends portal and API traffic, when it differs
   * from `portal`: the new project's run.app service, while `portal` stays the old run.app host the legacy forwarder
   * still serves (so it stays in every allowlist). Read only by server/infrastructure/frontdoor. Absent = `portal`.
   */
  portalUpstream?: string;
}

export interface EnvironmentHosts {
  /** The apex domain, e.g. "example.com"; null until it is chosen. */
  domain: string | null;
  /** The portal and API live on this label under the apex. */
  portalSubdomain: string;
  /** Mail is sent from this label under the apex (the Resend domain); null = the apex itself. */
  mailSubdomain: string | null;
  stage: Stage;
  /** Where the landing and the portal answer today; they keep answering after the move. */
  legacy: LegacyOrigins;
}

export type HostsConfig = Record<string, EnvironmentHosts>;

export interface FrontDoorHosts {
  zone: string;
  landingHost: string;
  portalHost: string;
  /** The portal's origin through the front door: the server's PORTAL_ORIGIN from stage proxy on. */
  portalOrigin: string;
  /** The Cloud Run origin the front door forwards to. */
  upstreamOrigin: string;
  /** The Netlify site the apex's `www` points at. */
  netlifyHost: string;
}

export interface ResolvedHosts {
  environment: string;
  domain: string | null;
  stage: Stage;
  /** The domain mail is sent from (no-reply@<mailDomain>): <mailSubdomain>.<apex>, the apex without one, null without a domain. */
  mailDomain: string | null;
  /** What builds, links and the phone use: the new hosts from stage live on, the legacy ones before. */
  landingOrigin: string;
  portalOrigin: string;
  /** The legacy origins once a domain is set (they keep answering); null before. */
  legacy: { landingOrigin: string; portalOrigin: string } | null;
  /** Old-host pages are sent on to the new hosts. */
  redirectLegacy: boolean;
  /** Every origin of ours a page may reference: new first, then legacy. */
  allOrigins: string[];
  /** Hosts the phone claims for universal links and saved passwords, new first. */
  appLinkHosts: string[];
  frontDoor: FrontDoorHosts | null;
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+$/;

function fail(env: string, field: string, value: unknown, rule: string): never {
  throw new Error(`config/hosts.json: ${env}.${field} ${rule}, got ${JSON.stringify(value)}`);
}

function parseEnvironment(env: string, value: unknown): EnvironmentHosts {
  const v = (value ?? {}) as Record<string, unknown>;
  const { domain, portalSubdomain, stage } = v;
  const mailSubdomain = v.mailSubdomain ?? null;
  const legacy = (v.legacy ?? {}) as Record<string, unknown>;
  if (domain !== null && (typeof domain !== 'string' || !DOMAIN.test(domain))) {
    fail(env, 'domain', domain, 'must be null or a bare lowercase domain such as "example.com"');
  }
  if (typeof portalSubdomain !== 'string' || !LABEL.test(portalSubdomain)) {
    fail(env, 'portalSubdomain', portalSubdomain, 'must be one lowercase DNS label');
  }
  if (mailSubdomain !== null && (typeof mailSubdomain !== 'string' || !LABEL.test(mailSubdomain) || mailSubdomain === portalSubdomain)) {
    fail(env, 'mailSubdomain', mailSubdomain, 'must be absent, null, or one lowercase DNS label other than portalSubdomain');
  }
  if (!(STAGES as readonly unknown[]).includes(stage)) fail(env, 'stage', stage, `must be one of ${STAGES.join(', ')}`);
  if ((domain === null) !== (stage === 'legacy')) fail(env, 'stage', stage, 'is "legacy" exactly when domain is null');
  for (const key of ['landing', 'portal'] as const) {
    if (typeof legacy[key] !== 'string' || !HTTPS_ORIGIN.test(legacy[key])) {
      fail(env, `legacy.${key}`, legacy[key], 'must be a bare https origin');
    }
  }
  if (legacy.portalUpstream !== undefined && (typeof legacy.portalUpstream !== 'string' || !HTTPS_ORIGIN.test(legacy.portalUpstream))) {
    fail(env, 'legacy.portalUpstream', legacy.portalUpstream, 'must be absent or a bare https origin');
  }
  const legacyOrigins: LegacyOrigins = { landing: legacy.landing as string, portal: legacy.portal as string };
  if (typeof legacy.portalUpstream === 'string') legacyOrigins.portalUpstream = legacy.portalUpstream;
  const underDomain = (host: string) => host === domain || host.endsWith(`.${domain}`);
  if (domain !== null && Object.values(legacyOrigins).some((origin) => underDomain(new URL(origin).hostname))) {
    fail(env, 'domain', domain, 'must differ from the legacy hosts');
  }
  return { domain: domain as string | null, portalSubdomain, mailSubdomain: mailSubdomain as string | null, stage: stage as Stage, legacy: legacyOrigins };
}

/** Validates the file's shape; throws naming the bad field. Keys starting with `$` are comments. */
export function parseHostsConfig(raw: unknown): HostsConfig {
  const entries = Object.entries((raw ?? {}) as Record<string, unknown>).filter(([key]) => !key.startsWith('$'));
  if (entries.length === 0) throw new Error('config/hosts.json: names no environment');
  return Object.fromEntries(entries.map(([env, value]) => [env, parseEnvironment(env, value)]));
}

/** The hosts one environment serves from, and the legacy ones that keep answering. */
export function resolveHosts(config: HostsConfig, environment = 'production'): ResolvedHosts {
  const env = config[environment];
  if (!env) throw new Error(`config/hosts.json: no "${environment}" environment`);
  const { domain, portalSubdomain, mailSubdomain, stage, legacy } = env;
  const legacyPortalHost = new URL(legacy.portal).hostname;
  if (domain === null) {
    return {
      environment,
      domain,
      stage,
      mailDomain: null,
      landingOrigin: legacy.landing,
      portalOrigin: legacy.portal,
      legacy: null,
      redirectLegacy: false,
      allOrigins: [legacy.landing, legacy.portal],
      appLinkHosts: [legacyPortalHost],
      frontDoor: null,
    };
  }
  const portalHost = `${portalSubdomain}.${domain}`;
  const newLanding = `https://${domain}`;
  const newPortal = `https://${portalHost}`;
  const live = stage === 'live' || stage === 'redirect';
  return {
    environment,
    domain,
    stage,
    mailDomain: mailSubdomain === null ? domain : `${mailSubdomain}.${domain}`,
    landingOrigin: live ? newLanding : legacy.landing,
    portalOrigin: live ? newPortal : legacy.portal,
    legacy: { landingOrigin: legacy.landing, portalOrigin: legacy.portal },
    redirectLegacy: stage === 'redirect',
    allOrigins: [newLanding, newPortal, legacy.landing, legacy.portal],
    appLinkHosts: [portalHost, legacyPortalHost],
    frontDoor: {
      zone: domain,
      landingHost: domain,
      portalHost,
      portalOrigin: newPortal,
      upstreamOrigin: legacy.portal,
      netlifyHost: new URL(legacy.landing).hostname,
    },
  };
}

/** Production's hosts, as checked in. */
export const HOSTS: ResolvedHosts = resolveHosts(parseHostsConfig(raw));
