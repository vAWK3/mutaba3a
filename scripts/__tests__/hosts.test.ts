// @vitest-environment node
import { describe, it, expect } from 'vitest';
import raw from '../../config/hosts.json';
import noDomain from '../../config/fixtures/hosts.no-domain.json';
import placeholder from '../../config/fixtures/hosts.placeholder.json';
import { HOSTS, parseHostsConfig, resolveHosts } from '../../config/hosts';

const LEGACY = { landing: 'https://landing.netlify.example', portal: 'https://portal-abc-zf.run.example' };

function config(env: Record<string, unknown> = {}): unknown {
  return { production: { domain: null, portalSubdomain: 'app', stage: 'legacy', legacy: LEGACY, ...env } };
}
const at = (stage: string) => resolveHosts(parseHostsConfig(config({ domain: 'placeholder.example', stage })));

describe('config/hosts (MUT-326)', () => {
  describe('parseHostsConfig', () => {
    it('accepts the checked-in file and both fixtures', () => {
      for (const file of [raw, noDomain, placeholder]) expect(() => parseHostsConfig(file)).not.toThrow();
    });

    // MUT-487 (AM11): the front door's upstream can move to the new project's service while legacy.portal, the old
    // run.app host the forwarder still serves, stays in every allowlist.
    it('reads legacy.portalUpstream, the Worker\'s upstream, apart from legacy.portal', () => {
      const parsed = parseHostsConfig(config({ legacy: { ...LEGACY, portalUpstream: 'https://portal-new-zf.run.example' } }));
      expect(parsed.production?.legacy).toEqual({ ...LEGACY, portalUpstream: 'https://portal-new-zf.run.example' });
      expect(parseHostsConfig(config()).production?.legacy.portalUpstream).toBeUndefined();
      expect(() => parseHostsConfig(config({ legacy: { ...LEGACY, portalUpstream: 'http://portal-new.run.example' } }))).toThrow(/legacy.portalUpstream/);
      expect(() => parseHostsConfig(config({ legacy: { ...LEGACY, portalUpstream: 'https://portal-new.run.example/v1' } }))).toThrow(/legacy.portalUpstream/);
      const hosts = resolveHosts(parseHostsConfig(config({ domain: 'placeholder.example', stage: 'live', legacy: { ...LEGACY, portalUpstream: 'https://portal-new-zf.run.example' } })));
      expect(hosts.legacy).toEqual({ landingOrigin: LEGACY.landing, portalOrigin: LEGACY.portal });
      expect(hosts.allOrigins).toContain(LEGACY.portal);
      expect(hosts.allOrigins).not.toContain('https://portal-new-zf.run.example');
    });

    it('ignores $-prefixed keys such as $comment', () => {
      expect(Object.keys(parseHostsConfig({ $comment: 'x', ...(config() as object) }))).toEqual(['production']);
    });

    it.each([
      ['an uppercase domain', { domain: 'Example.com', stage: 'proxy' }, /domain/],
      ['a domain with a scheme', { domain: 'https://example.com', stage: 'proxy' }, /domain/],
      ['a domain with a path', { domain: 'example.com/x', stage: 'proxy' }, /domain/],
      ['a single-label domain', { domain: 'localhost', stage: 'proxy' }, /domain/],
      ['a trailing dot', { domain: 'example.com.', stage: 'proxy' }, /domain/],
      ['an empty domain', { domain: '', stage: 'proxy' }, /domain/],
      ['a dotted subdomain', { portalSubdomain: 'a.b' }, /portalSubdomain/],
      ['an empty subdomain', { portalSubdomain: '' }, /portalSubdomain/],
      ['a dotted mail subdomain', { mailSubdomain: 'a.b' }, /mailSubdomain/],
      ['a mail subdomain equal to the portal one', { mailSubdomain: 'app' }, /mailSubdomain/],
      ['an unknown stage', { stage: 'on' }, /stage must be one of/],
      ['a live stage without a domain', { stage: 'live' }, /legacy" exactly when domain is null/],
      ['a domain left at the legacy stage', { domain: 'placeholder.example' }, /legacy" exactly when domain is null/],
      ['an http legacy origin', { legacy: { ...LEGACY, landing: 'http://landing.example' } }, /legacy\.landing/],
      ['a legacy origin with a path', { legacy: { ...LEGACY, portal: 'https://x.example/app' } }, /legacy\.portal/],
      ['a domain the legacy hosts live under', { domain: 'netlify.example', stage: 'proxy' }, /differ from the legacy/],
    ])('refuses %s, naming the field', (_name, env, message) => {
      expect(() => parseHostsConfig(config(env))).toThrow(message);
    });

    it('refuses a config with no environments', () => {
      expect(() => parseHostsConfig({ $comment: 'x' })).toThrow(/environment/);
    });
  });

  describe('resolveHosts', () => {
    it('sends mail from <mailSubdomain>.<apex>, the apex without one, and nowhere without a domain', () => {
      const live = (env: object) => resolveHosts(parseHostsConfig(config({ domain: 'placeholder.example', stage: 'live', ...env }))).mailDomain;
      expect(live({ mailSubdomain: 'notify' })).toBe('notify.placeholder.example');
      expect(live({})).toBe('placeholder.example');
      expect(live({ mailSubdomain: null })).toBe('placeholder.example');
      expect(resolveHosts(parseHostsConfig(config({ mailSubdomain: 'notify' }))).mailDomain).toBeNull();
    });

    it('serves from the legacy hosts while no domain is set', () => {
      const hosts = resolveHosts(parseHostsConfig(config()));
      expect(hosts).toMatchObject({
        environment: 'production',
        domain: null,
        stage: 'legacy',
        landingOrigin: LEGACY.landing,
        portalOrigin: LEGACY.portal,
        legacy: null,
        redirectLegacy: false,
        frontDoor: null,
      });
      expect(hosts.allOrigins).toEqual([LEGACY.landing, LEGACY.portal]);
      expect(hosts.appLinkHosts).toEqual(['portal-abc-zf.run.example']);
    });

    it('proxy: builds the front door but keeps every build on the legacy hosts', () => {
      const hosts = at('proxy');
      expect([hosts.landingOrigin, hosts.portalOrigin, hosts.redirectLegacy]).toEqual([LEGACY.landing, LEGACY.portal, false]);
      expect(hosts.frontDoor).toEqual({
        zone: 'placeholder.example',
        landingHost: 'placeholder.example',
        portalHost: 'app.placeholder.example',
        portalOrigin: 'https://app.placeholder.example',
        upstreamOrigin: LEGACY.portal,
        netlifyHost: 'landing.netlify.example',
      });
      expect(hosts.legacy).toEqual({ landingOrigin: LEGACY.landing, portalOrigin: LEGACY.portal });
    });

    it('live: builds use the apex and the subdomain; the legacy hosts keep answering', () => {
      const hosts = at('live');
      expect([hosts.landingOrigin, hosts.portalOrigin, hosts.redirectLegacy]).toEqual(['https://placeholder.example', 'https://app.placeholder.example', false]);
      expect(hosts.allOrigins).toEqual(['https://placeholder.example', 'https://app.placeholder.example', LEGACY.landing, LEGACY.portal]);
      // During the transition release the phone claims both hosts (MUT-112: old links and saved passwords keep working)
      expect(hosts.appLinkHosts).toEqual(['app.placeholder.example', 'portal-abc-zf.run.example']);
    });

    it('redirect: live, plus old-host pages are sent on', () => {
      expect(at('redirect')).toMatchObject({ portalOrigin: 'https://app.placeholder.example', redirectLegacy: true });
    });

    it('refuses an environment the file does not name', () => {
      expect(() => resolveHosts(parseHostsConfig(config()), 'staging')).toThrow(/staging/);
    });
  });

  it('HOSTS is the checked-in production config, resolved', () => {
    expect(HOSTS).toEqual(resolveHosts(parseHostsConfig(raw), 'production'));
  });

  /**
   * Terraform derives the same values from these fixtures (server/infrastructure/{terraform,frontdoor,sentry}/tests);
   * pinning them here keeps the TypeScript and HCL derivations in step.
   */
  describe('fixtures shared with the Terraform tests', () => {
    it('no-domain: legacy hosts only', () => {
      const hosts = resolveHosts(parseHostsConfig(noDomain));
      expect([hosts.landingOrigin, hosts.portalOrigin, hosts.frontDoor]).toEqual(['https://landing.example.test', 'https://portal.example.test', null]);
    });

    it('placeholder: apex, app subdomain and both legacy hosts', () => {
      const config = parseHostsConfig(placeholder);
      const hosts = resolveHosts(config);
      expect(hosts.allOrigins).toEqual(['https://placeholder.example', 'https://app.placeholder.example', 'https://landing.example.test', 'https://portal.example.test']);
      expect(hosts.frontDoor?.portalOrigin).toBe('https://app.placeholder.example');
      expect(resolveHosts(config, 'staging').frontDoor?.portalHost).toBe('app.staging-placeholder.example');
    });
  });
});
