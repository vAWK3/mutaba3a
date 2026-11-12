#!/usr/bin/env node
/**
 * MUT-596 / MUT-597 QA: a stand-in for one Malafat firm's own server, the half Sign in with Malafat talks to
 * (MAL-1539's shapes, as server/src/malafat/sign-in-client.ts calls them):
 *
 *   GET  /.well-known/oauth-authorization-server   the office preflight: 200 for the stub's office, 404 for any other
 *   GET  /oauth/authorize                           auto-consents as the chosen person, 302 back with ?code&state
 *   POST /api/oauth/token                           code + PKCE verifier → tokens (single use)
 *   GET  /api/oauth/userinfo                        the person's claims
 *   POST /api/oauth/revoke                          always 200
 *
 * It listens on 127.0.0.1:3939 and answers for http://{slug}.lvh.me:3939 (lvh.me resolves to 127.0.0.1 in public
 * DNS, so no /etc/hosts change). Point the API at it with MALAFAT_SIGN_IN=true and
 * MALAFAT_ORIGIN_TEMPLATE=http://{slug}.lvh.me:3939. The office is `sader` (MALAFAT_STUB_TENANT).
 *
 * Who it signs in as, per authorize request: a `qa_person` cookie on the stub's host, an `X-QA-Person` header, or
 * `?qa_person=` on authorize; otherwise the default, which `POST /__qa/person {"person":"new"}` sets (and
 * `{"person":{…claims}}` sets to anyone). `qa_deny=1` (cookie, header `X-QA-Deny: 1`, or query) answers
 * access_denied, as a person tapping Deny in Malafat. `GET /__qa/people` lists the presets.
 *
 * Redirects go only to an MTB3A callback (`/v1/auth/malafat/callback`) on a loopback or *.lvh.me host, plus any
 * exact URI in MALAFAT_STUB_REDIRECTS (comma-separated). A QA tool, never deployed: it keeps everything in memory.
 */
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { assertPortFree } from '../support/port-check.mjs';
import { OFFICE, PEOPLE, TENANT_SLUG } from './malafat-people.mjs';

const PORT = Number(process.env.MALAFAT_STUB_PORT ?? 3939);
const CLIENT_ID = process.env.MALAFAT_STUB_CLIENT_ID ?? 'mtb3a';
const EXTRA_REDIRECTS = new Set((process.env.MALAFAT_STUB_REDIRECTS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const CALLBACK_PATH = '/v1/auth/malafat/callback';
const CODE_TTL_MS = 60_000;

let defaultPerson = PEOPLE.linked;
/** code → { person, redirectUri, challenge, expiresAt } */
const codes = new Map();
/** access token → person */
const tokens = new Map();

const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const token = () => randomBytes(24).toString('base64url');

function cookiesOf(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name]) => name)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join('='))]),
  );
}

/** A preset name, or JSON claims; null when it names nobody. */
function personOf(value) {
  if (!value) return null;
  if (PEOPLE[value]) return PEOPLE[value];
  try {
    const claims = JSON.parse(value);
    return claims && typeof claims.email === 'string' && typeof claims.sub === 'string' ? { role: 'ASSOCIATE', name: null, locale: 'ar', ...claims } : null;
  } catch {
    return null;
  }
}

function slugOf(req) {
  const host = (req.headers.host ?? '').split(':')[0];
  return host.endsWith('.lvh.me') ? host.slice(0, -'.lvh.me'.length) : null;
}

function allowedRedirect(uri) {
  if (EXTRA_REDIRECTS.has(uri)) return true;
  try {
    const url = new URL(uri);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.lvh.me');
    return url.protocol === 'http:' && loopback && url.pathname === CALLBACK_PATH && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...(json ? { 'content-type': 'application/json' } : {}), 'cache-control': 'no-store', ...headers });
  res.end(json);
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] ?? '').includes('application/json')) return raw ? JSON.parse(raw) : {};
  return Object.fromEntries(new URLSearchParams(raw));
}

function authorize(req, res, url) {
  const q = url.searchParams;
  const redirectUri = q.get('redirect_uri') ?? '';
  if (q.get('client_id') !== CLIENT_ID || !allowedRedirect(redirectUri)) return send(res, 400, { error: 'invalid_request', error_description: 'unknown client or redirect_uri' });
  const back = new URL(redirectUri);
  const state = q.get('state');
  if (state) back.searchParams.set('state', state);
  const cookies = cookiesOf(req);
  const deny = [cookies.qa_deny, req.headers['x-qa-deny'], q.get('qa_deny')].includes('1');
  if (deny) {
    back.searchParams.set('error', 'access_denied');
    return send(res, 302, undefined, { location: back.toString() });
  }
  if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
    back.searchParams.set('error', 'invalid_request');
    return send(res, 302, undefined, { location: back.toString() });
  }
  const chosen = q.get('qa_person') ?? req.headers['x-qa-person'] ?? cookies.qa_person;
  const person = chosen ? personOf(chosen) : defaultPerson;
  if (!person) return send(res, 400, { error: 'invalid_request', error_description: `qa_person names nobody: ${chosen}` });
  const code = token();
  codes.set(code, { person, redirectUri, challenge: q.get('code_challenge'), expiresAt: Date.now() + CODE_TTL_MS });
  back.searchParams.set('code', code);
  console.log(`[malafat-stub] authorize as ${person.email} (${person.role}) → ${back.origin}${back.pathname}`);
  return send(res, 302, undefined, { location: back.toString() });
}

async function exchange(req, res) {
  const body = await bodyOf(req);
  const grant = codes.get(body.code);
  codes.delete(body.code);
  const valid = grant && grant.expiresAt > Date.now() && body.grant_type === 'authorization_code' && body.client_id === CLIENT_ID && body.redirect_uri === grant.redirectUri && s256(body.code_verifier ?? '') === grant.challenge;
  if (!valid) return send(res, 400, { error: 'invalid_grant' });
  const access = token();
  tokens.set(access, grant.person);
  return send(res, 200, { access_token: access, refresh_token: token(), token_type: 'Bearer', expires_in: 300 });
}

function userinfo(req, res) {
  const access = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const person = tokens.get(access);
  if (!person) return send(res, 401, { error: 'invalid_token' });
  return send(res, 200, { sub: person.sub, ...OFFICE, role: person.role, email: person.email, email_verified: true, name: person.name, locale: person.locale });
}

async function qaPerson(req, res) {
  const body = await bodyOf(req);
  const person = typeof body.person === 'string' ? personOf(body.person) : personOf(JSON.stringify(body.person ?? null));
  if (!person) return send(res, 422, { error: 'person must be a preset name or claims with sub and email', presets: Object.keys(PEOPLE) });
  defaultPerson = person;
  return send(res, 200, { person });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://stub');
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /__qa/people') return send(res, 200, { office: OFFICE, people: PEOPLE, default: defaultPerson });
    if (route === 'POST /__qa/person') return await qaPerson(req, res);
    // Every Malafat call is for one office's host; another slug is no office (the portal's "not found").
    if (slugOf(req) !== TENANT_SLUG) return send(res, 404, { error: 'not_found' });
    if (route === 'GET /.well-known/oauth-authorization-server') {
      const issuer = `http://${req.headers.host}`;
      return send(res, 200, { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/api/oauth/token`, userinfo_endpoint: `${issuer}/api/oauth/userinfo`, code_challenge_methods_supported: ['S256'] });
    }
    if (route === 'GET /oauth/authorize') return authorize(req, res, url);
    if (route === 'POST /api/oauth/token') return await exchange(req, res);
    if (route === 'GET /api/oauth/userinfo') return userinfo(req, res);
    if (route === 'POST /api/oauth/revoke') return send(res, 200, {});
    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('[malafat-stub]', error);
    return send(res, 500, { error: 'server_error' });
  }
});

await assertPortFree(PORT, 'malafat-stub');
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[malafat-stub] office "${TENANT_SLUG}" at http://${TENANT_SLUG}.lvh.me:${PORT} (default person: ${defaultPerson.email})`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
