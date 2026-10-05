import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OAUTH_LOOPBACK_PORTS, loopbackRedirectUris, CIMD_CLIENT_ID } from '../oauth-client';

/**
 * Guards the Client ID Metadata Document we publish at
 * https://mutaba3a.app/.well-known/oauth-client.json
 *
 * Malafat fetches this document and validates it in
 * apps/web/src/features/oauth/domain/cimd-url.ts. Two of those checks fail in
 * ways that are miserable to debug against a live tenant:
 *
 *   - `client_id` must equal, byte for byte, the URL the document was fetched
 *     from. A trailing slash or an http/https slip reads as impersonation.
 *   - `redirect_uris` is an EXACT-match allowlist on the server
 *     (authorization-request-service.ts:106). A port the app binds but the
 *     document does not list fails closed, without redirecting.
 *
 * So this test re-states the server's rules locally and checks the shipped
 * artifact against them, plus checks the document agrees with the ports the
 * code actually binds.
 */

const CIMD_PATH = resolve(process.cwd(), 'public/.well-known/oauth-client.json');

interface CimdDocument {
  client_id?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  logo_uri?: unknown;
  redirect_uris?: unknown;
}

function loadDocument(): CimdDocument {
  return JSON.parse(readFileSync(CIMD_PATH, 'utf8')) as CimdDocument;
}

/** Mirror of Malafat's `isAcceptableRedirectUri`. */
function isAcceptableRedirectUri(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** Mirror of Malafat's `parseCimdUrl` constraints on the client_id URL. */
function isAcceptableCimdUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.hash !== '') return false;
  // URL normalises an explicit :443 to '', so any non-empty port is non-default
  // and the server refuses it.
  if (url.port !== '') return false;
  return true;
}

describe('published CIMD document', () => {
  it('exists where netlify will serve it', () => {
    expect(() => loadDocument()).not.toThrow();
  });

  it('is served from a .json path so the content-type is correct without a header rule', () => {
    // Malafat refuses a document whose content-type is not JSON
    // (cimd-fetcher.ts:180). Netlify's SPA fallback would otherwise serve
    // index.html as text/html for an extensionless path.
    expect(CIMD_PATH.endsWith('.json')).toBe(true);
    expect(CIMD_CLIENT_ID.endsWith('.json')).toBe(true);
  });

  it('declares a client_id byte-equal to the URL it is published at', () => {
    expect(loadDocument().client_id).toBe(CIMD_CLIENT_ID);
  });

  it('declares a client_id the server will accept as a CIMD URL', () => {
    expect(isAcceptableCimdUrl(CIMD_CLIENT_ID)).toBe(true);
  });

  it('has a non-empty client_name within the server length limit', () => {
    const name = loadDocument().client_name;
    expect(typeof name).toBe('string');
    expect(String(name).trim()).not.toBe('');
    expect(String(name).length).toBeLessThanOrEqual(255);
  });

  it('lists at least one redirect_uri and no more than the server allows', () => {
    const uris = loadDocument().redirect_uris as unknown[];
    expect(Array.isArray(uris)).toBe(true);
    expect(uris.length).toBeGreaterThan(0);
    expect(uris.length).toBeLessThanOrEqual(50);
  });

  it('lists only redirect_uris the server accepts', () => {
    for (const uri of loadDocument().redirect_uris as unknown[]) {
      expect(isAcceptableRedirectUri(uri), `rejected: ${String(uri)}`).toBe(true);
    }
  });

  it('registers every port the app is willing to bind', () => {
    // The server does exact matching, so a port bound but unregistered fails
    // closed. This is the check that keeps code and document in step.
    const registered = new Set(loadDocument().redirect_uris as string[]);
    for (const uri of loopbackRedirectUris()) {
      expect(registered.has(uri), `port not registered in CIMD document: ${uri}`).toBe(true);
    }
  });

  it('registers both loopback spellings for each port', () => {
    const registered = new Set(loadDocument().redirect_uris as string[]);
    for (const port of OAUTH_LOOPBACK_PORTS) {
      expect(registered.has(`http://127.0.0.1:${port}/callback`)).toBe(true);
      expect(registered.has(`http://localhost:${port}/callback`)).toBe(true);
    }
  });

  it('offers fallback ports — a fixed single port makes a collision unrecoverable', () => {
    // RFC 8252 wants an ephemeral port, but Malafat matches redirect_uris
    // exactly, so the port must be pre-registered. Fallbacks are the
    // compromise; one port would mean any process squatting it blocks sign-in.
    expect(OAUTH_LOOPBACK_PORTS.length).toBeGreaterThanOrEqual(3);
  });
});
