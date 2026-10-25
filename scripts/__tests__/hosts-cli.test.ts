// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseHostsConfig, resolveHosts } from '../../config/hosts';
import { domainPlan, getValue, main, withDomain } from '../hosts';

const LEGACY = { landing: 'https://old.netlify.example', portal: 'https://old-portal-abc-zf.run.example' };
const config = (env: Record<string, unknown> = {}) =>
  parseHostsConfig({ production: { domain: null, portalSubdomain: 'app', stage: 'legacy', legacy: LEGACY, ...env } });

describe('scripts/hosts.ts (MUT-326)', () => {
  describe('get', () => {
    it.each([
      ['landingOrigin', LEGACY.landing],
      ['portalOrigin', LEGACY.portal],
      ['domain', ''],
      ['mailDomain', ''],
    ])('prints %s', (key, value) => {
      expect(getValue(resolveHosts(config()), key)).toBe(value);
    });

    it('refuses an unknown key, listing the known ones', () => {
      expect(() => getValue(resolveHosts(config()), 'nope')).toThrow(/landingOrigin/);
    });
  });

  describe('withDomain', () => {
    it('previews a domain without touching the file', () => {
      expect(resolveHosts(withDomain(config(), 'production', 'placeholder.example')).portalOrigin).toBe('https://app.placeholder.example');
      expect(resolveHosts(config()).domain).toBeNull();
    });

    it('validates the previewed domain like the file', () => {
      expect(() => withDomain(config(), 'production', 'https://x.example')).toThrow(/domain/);
    });
  });

  describe('plan', () => {
    const now = resolveHosts(config());
    const next = resolveHosts(withDomain(config(), 'production', 'placeholder.example'));
    const plan = domainPlan(now, next);

    it('names every consumer of the hosts', () => {
      for (const consumer of [
        'DEFAULT_PUBLIC_ORIGIN',
        'DEFAULT_PORTAL_URL',
        'MUTABA3A_PUBLIC_ORIGIN',
        'PORTAL_ORIGIN',
        'FRONT_DOOR_TOKEN',
        'PORTAL_LEGACY_REDIRECT',
        'terraform',
        'frontdoor',
        'Sentry',
        'MUTABA3A_API_BASE_URL',
        'MUTABA3A_PORTAL_BASE_URL',
        'MUTABA3A_LINK_HOST',
        'AndroidManifest.xml',
        'asset_statements',
        'malafat-web-mutaba3a-api-url',
        '_redirects',
        'uptime',
      ]) {
        expect(plan, consumer).toContain(consumer);
      }
    });

    it('shows each value before and after', () => {
      expect(plan).toContain(`${LEGACY.landing} → https://placeholder.example`);
      expect(plan).toContain(`${LEGACY.portal} → https://app.placeholder.example`);
    });

    it('keeps the old host claimed by the phone during the transition release', () => {
      expect(plan).toMatch(/applinks:app\.placeholder\.example/);
      expect(plan).toMatch(/applinks:old-portal-abc-zf\.run\.example/);
      expect(plan).toMatch(/android:host="app\.placeholder\.example"/);
      expect(plan).toMatch(/android:host="old-portal-abc-zf\.run\.example"/);
      expect(plan).toContain('https://app.placeholder.example/.well-known/assetlinks.json');
      expect(plan).toContain('https://old-portal-abc-zf.run.example/.well-known/assetlinks.json');
    });

    it('shows the Netlify rules each stage adds', () => {
      expect(plan).toContain('placeholder.example/app/* → https://old.netlify.example/app');
      expect(plan).not.toContain('/download, /privacy');
      const redirect = domainPlan(now, resolveHosts(withDomain(config(), 'production', 'placeholder.example', 'redirect')));
      expect(redirect).toContain('/, /download, /privacy, /terms* → https://placeholder.example');
      expect(redirect).toMatch(/PORTAL_LEGACY_REDIRECT +unset → true/);
    });

    it('proxy: the front door and Cloud Run move, the builds do not', () => {
      const proxy = domainPlan(now, resolveHosts(withDomain(config(), 'production', 'placeholder.example', 'proxy')));
      expect(proxy).toMatch(/DEFAULT_PORTAL_URL +=/);
      expect(proxy).toMatch(/PORTAL_ORIGIN +unset → https:\/\/app\.placeholder\.example/);
    });

    it('says plainly when nothing changes', () => {
      expect(domainPlan(now, now)).toMatch(/No domain is set/);
    });
  });

  describe('main', () => {
    const io = () => {
      const out: string[] = [];
      const err: string[] = [];
      return { out, err, write: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
    };

    it('get prints one value with a newline', () => {
      const { out, write } = io();
      expect(main(['get', 'portalOrigin'], config(), write)).toBe(0);
      expect(out.join('')).toBe(`${LEGACY.portal}\n`);
    });

    it('plan --domain previews, plan alone reports the file', () => {
      const a = io();
      expect(main(['plan', '--domain', 'placeholder.example'], config(), a.write)).toBe(0);
      expect(a.out.join('')).toContain('https://app.placeholder.example');
      const b = io();
      expect(main(['plan'], config(), b.write)).toBe(0);
      expect(b.out.join('')).toMatch(/No domain is set/);
    });

    it('--env picks the environment', () => {
      const { err, write } = io();
      expect(main(['get', 'portalOrigin', '--env', 'staging'], config(), write)).toBe(1);
      expect(err.join('')).toMatch(/staging/);
    });

    it('usage on a bad command', () => {
      const { err, write } = io();
      expect(main(['frobnicate'], config(), write)).toBe(2);
      expect(err.join('')).toMatch(/usage/i);
    });
  });
});
