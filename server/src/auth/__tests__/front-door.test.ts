import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  FORWARDER_HEADER,
  FRONT_DOOR_CLIENT_IP_HEADER,
  FRONT_DOOR_HEADER,
  isSamePortalOrigin,
  isViaFrontDoor,
  requestClientIp,
  type HeaderReader,
} from '../sessions.js';

/**
 * MUT-326 (ADR-155 D3): during the domain move the service is reached two ways:
 * directly on run.app (old phones, Malafat, the carry-over) and through the
 * Cloudflare front door. One TRUSTED_PROXY_HOPS can't be right for both, so the
 * front door proves itself with a token and hands over the client IP and origin.
 */
const TOKEN = 't'.repeat(48);
const PORTAL = 'https://app.placeholder.example';
const RUN_APP = 'https://service.a.run.app';

function headers(map: Record<string, string>): HeaderReader {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return (name) => lower[name.toLowerCase()];
}

const viaDoor = (extra: Record<string, string> = {}) => headers({ [FRONT_DOOR_HEADER]: TOKEN, ...extra });

describe('isViaFrontDoor', () => {
  it('is true only for the exact token', () => {
    expect(isViaFrontDoor(viaDoor(), TOKEN)).toBe(true);
    expect(isViaFrontDoor(headers({ [FRONT_DOOR_HEADER]: `${TOKEN}x` }), TOKEN)).toBe(false);
    expect(isViaFrontDoor(headers({ [FRONT_DOOR_HEADER]: TOKEN.slice(1) }), TOKEN)).toBe(false);
    expect(isViaFrontDoor(headers({ [FRONT_DOOR_HEADER]: '' }), TOKEN)).toBe(false);
    expect(isViaFrontDoor(headers({}), TOKEN)).toBe(false);
  });

  it('is false whenever no token is configured, whatever the request says', () => {
    expect(isViaFrontDoor(viaDoor(), undefined)).toBe(false);
    expect(isViaFrontDoor(headers({ [FRONT_DOOR_HEADER]: '' }), undefined)).toBe(false);
  });
});

describe('requestClientIp', () => {
  const settings = { trustedProxyHops: 1, frontDoorToken: TOKEN };

  it('through the front door: the IP the front door read at its edge', () => {
    expect(requestClientIp(viaDoor({ [FRONT_DOOR_CLIENT_IP_HEADER]: '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 104.16.0.1' }), settings)).toBe('203.0.113.7');
    expect(requestClientIp(viaDoor({ [FRONT_DOOR_CLIENT_IP_HEADER]: '2001:db8::1' }), settings)).toBe('2001:db8::1');
  });

  it('through the front door without a usable IP: "unknown", never the front door\'s own address', () => {
    expect(requestClientIp(viaDoor({ 'x-forwarded-for': '104.16.0.1' }), settings)).toBe('unknown');
    expect(requestClientIp(viaDoor({ [FRONT_DOOR_CLIENT_IP_HEADER]: '1.2.3.4, 5.6.7.8' }), settings)).toBe('unknown');
    expect(requestClientIp(viaDoor({ [FRONT_DOOR_CLIENT_IP_HEADER]: 'not an ip' }), settings)).toBe('unknown');
  });

  it('directly: X-Forwarded-For with the configured hops; a forged front-door IP header is ignored', () => {
    const direct = headers({ [FRONT_DOOR_CLIENT_IP_HEADER]: '9.9.9.9', [FRONT_DOOR_HEADER]: 'guess', 'x-forwarded-for': 'forged, 198.51.100.4' });
    expect(requestClientIp(direct, settings)).toBe('198.51.100.4');
  });

  it('with no token configured: exactly today\'s rule', () => {
    const h = viaDoor({ [FRONT_DOOR_CLIENT_IP_HEADER]: '9.9.9.9', 'x-forwarded-for': 'forged, 198.51.100.4' });
    expect(requestClientIp(h, { trustedProxyHops: 1 })).toBe('198.51.100.4');
  });
});

/**
 * MUT-487 (ADR-232, R5/D9): the legacy run.app forwarder relays old phone builds to the new project. Through it every
 * caller would share the forwarder's egress IP in the sign-in throttle, so it vouches for the caller's IP with its own
 * token. That token is trusted for the IP only: it never counts as the front door (carry-over, portal origin).
 */
describe('the forwarder token (MUT-487)', () => {
  const FORWARDER = 'f'.repeat(64);
  const settings = { trustedProxyHops: 1, frontDoorToken: TOKEN, forwarderToken: FORWARDER };
  const relayed = (extra: Record<string, string> = {}) => headers({ [FORWARDER_HEADER]: FORWARDER, ...extra });

  it('a relayed request\'s throttle key is the caller\'s IP, not the forwarder\'s', () => {
    const h = relayed({ [FRONT_DOOR_CLIENT_IP_HEADER]: '203.0.113.9', 'x-forwarded-for': '203.0.113.9, 34.0.0.1' });
    expect(requestClientIp(h, settings)).toBe('203.0.113.9');
  });

  it('a relayed request without a usable IP is "unknown", never the forwarder\'s address', () => {
    expect(requestClientIp(relayed({ 'x-forwarded-for': '34.0.0.1' }), settings)).toBe('unknown');
    expect(requestClientIp(relayed({ [FRONT_DOOR_CLIENT_IP_HEADER]: 'nope' }), settings)).toBe('unknown');
  });

  it('a wrong or absent forwarder token is a direct request: X-Forwarded-For with the configured hops', () => {
    const forged = headers({ [FORWARDER_HEADER]: 'guess', [FRONT_DOOR_CLIENT_IP_HEADER]: '9.9.9.9', 'x-forwarded-for': 'x, 198.51.100.4' });
    expect(requestClientIp(forged, settings)).toBe('198.51.100.4');
    const unconfigured = relayed({ [FRONT_DOOR_CLIENT_IP_HEADER]: '9.9.9.9', 'x-forwarded-for': 'x, 198.51.100.4' });
    expect(requestClientIp(unconfigured, { trustedProxyHops: 1, frontDoorToken: TOKEN })).toBe('198.51.100.4');
  });

  it('the forwarder token never passes isViaFrontDoor, in either header', () => {
    expect(isViaFrontDoor(relayed(), TOKEN)).toBe(false);
    expect(isViaFrontDoor(headers({ [FRONT_DOOR_HEADER]: FORWARDER }), TOKEN)).toBe(false);
  });

  it('a relayed portal write is judged by its own origin, not PORTAL_ORIGIN (the forwarder is not the front door)', () => {
    const req = { url: `${RUN_APP}/v1/sessions`, header: relayed({ origin: RUN_APP }) };
    expect(isSamePortalOrigin(req, { portalOrigin: PORTAL, frontDoorToken: TOKEN })).toBe(true);
    const viaPortal = { url: `${RUN_APP}/v1/sessions`, header: relayed({ origin: PORTAL }) };
    expect(isSamePortalOrigin(viaPortal, { portalOrigin: PORTAL, frontDoorToken: TOKEN })).toBe(false);
  });
});

describe('isSamePortalOrigin', () => {
  const req = (url: string, map: Record<string, string>) => ({ url, header: headers(map) });
  const withDoor = { portalOrigin: PORTAL, frontDoorToken: TOKEN };

  it('Sec-Fetch-Site still wins on every path', () => {
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { 'sec-fetch-site': 'same-origin' }), withDoor)).toBe(true);
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { 'sec-fetch-site': 'cross-site', origin: RUN_APP }), withDoor)).toBe(false);
  });

  it('through the front door, Origin must be the portal origin (the Worker rewrites Host to run.app)', () => {
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { [FRONT_DOOR_HEADER]: TOKEN, origin: PORTAL }), withDoor)).toBe(true);
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { [FRONT_DOOR_HEADER]: TOKEN, origin: RUN_APP }), withDoor)).toBe(false);
  });

  it('directly on run.app during the transition, Origin must be run.app itself', () => {
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { origin: RUN_APP }), withDoor)).toBe(true);
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { origin: PORTAL }), withDoor)).toBe(false);
  });

  it('with no token configured: PORTAL_ORIGIN when set, else the request\'s own origin (unchanged)', () => {
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { origin: PORTAL }), { portalOrigin: PORTAL })).toBe(true);
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, { origin: RUN_APP }), {})).toBe(true);
    expect(isSamePortalOrigin(req(`${RUN_APP}/v1/sessions`, {}), {})).toBe(false);
  });

  // Production passes Hono's own c.req, whose header() needs its `this`. A plain
  // { url, header } object can't catch a detached method (MUT-112 step 3 outage).
  it('reads a real Hono request when a token is configured, through the front door and directly', async () => {
    const app = new Hono().post('/v1/sessions', (c) => c.json({ same: isSamePortalOrigin(c.req, withDoor) }));
    const ask = async (map: Record<string, string>) => {
      const res = await app.request(`${RUN_APP}/v1/sessions`, { method: 'POST', headers: map });
      expect(res.status).toBe(200);
      return ((await res.json()) as { same: boolean }).same;
    };
    expect(await ask({ [FRONT_DOOR_HEADER]: TOKEN, origin: PORTAL })).toBe(true);
    expect(await ask({ origin: RUN_APP })).toBe(true);
    expect(await ask({ origin: 'https://elsewhere.example' })).toBe(false);
  });
});
