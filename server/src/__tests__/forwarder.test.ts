import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORWARDER_HEADER, FRONT_DOOR_CLIENT_IP_HEADER, FRONT_DOOR_HEADER } from '../auth/sessions.js';
import { createForwarder, FORWARDER_HEALTH_PATH, readForwarderEnv } from '../forwarder.js';

/**
 * MUT-487 (ADR-230, D6, AM4, R5/D9): after the move, the old run.app service is this forwarder. Old phone builds keep
 * calling run.app, and Dart doesn't follow redirects on a POST, so it relays every request as it came (method, path,
 * body, headers, status) to the new service, and vouches for the caller's IP with its own token. A request that already
 * carries the front door's header (the Cloudflare Worker, before its repoint) passes through unchanged.
 */
const TOKEN = 'f'.repeat(64);
type Seen = { method: string; url: string; headers: IncomingHttpHeaders; body: string };
let upstream: Server;
let forwarder: Server;
let seen: Seen[] = [];
let forwarderUrl: string;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/elsewhere' });
        res.end();
        return;
      }
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json', 'x-upstream': 'yes', 'set-cookie': ['a=1', 'b=2'] });
      res.end(JSON.stringify({ echoed: body }));
    });
  });
  const target = await listen(upstream);
  forwarder = createForwarder({ target, token: TOKEN });
  forwarderUrl = await listen(forwarder);
});

afterAll(async () => {
  await new Promise((done) => forwarder.close(done));
  await new Promise((done) => upstream.close(done));
});

function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  seen = [];
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request(`${forwarderUrl}${path}`, { method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

describe('the legacy forwarder (MUT-487)', () => {
  it('relays a POST with its body, path, query and headers, and returns the status, headers and body unchanged', async () => {
    const res = await call('/v1/entries?profile=abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer mut_live_x', 'x-app-build': '12' },
      body: '{"amount":1200}',
    });
    expect(res.status).toBe(201);
    expect(res.body).toBe('{"echoed":"{\\"amount\\":1200}"}');
    expect(res.headers['x-upstream']).toBe('yes');
    expect(res.headers['set-cookie']).toEqual(['a=1', 'b=2']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/entries?profile=abc', body: '{"amount":1200}' });
    expect(seen[0]?.headers).toMatchObject({ authorization: 'Bearer mut_live_x', 'x-app-build': '12', 'content-type': 'application/json' });
  });

  it('never follows a redirect: the caller gets it as the new service sent it', async () => {
    const res = await call('/redirect');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/elsewhere');
  });

  it('vouches for the caller\'s IP, read from its own X-Forwarded-For (one hop), with the forwarder token', async () => {
    await call('/v1/sessions', { method: 'POST', headers: { 'x-forwarded-for': 'forged, 203.0.113.9' }, body: '{}' });
    expect(seen[0]?.headers[FRONT_DOOR_CLIENT_IP_HEADER]).toBe('203.0.113.9');
    expect(seen[0]?.headers[FORWARDER_HEADER]).toBe(TOKEN);
    expect(seen[0]?.headers['x-forwarded-proto']).toBe('https');
  });

  it('overwrites a client-IP or forwarder header the caller made up', async () => {
    await call('/v1/sessions', { headers: { 'x-forwarded-for': '203.0.113.9', [FRONT_DOOR_CLIENT_IP_HEADER]: '1.1.1.1', [FORWARDER_HEADER]: 'guess' } });
    expect(seen[0]?.headers[FRONT_DOOR_CLIENT_IP_HEADER]).toBe('203.0.113.9');
    expect(seen[0]?.headers[FORWARDER_HEADER]).toBe(TOKEN);
  });

  it('passes a request through the front door (the Worker) unchanged: its own client IP, no forwarder token', async () => {
    await call('/v1/me', { headers: { [FRONT_DOOR_HEADER]: 'door-token', [FRONT_DOOR_CLIENT_IP_HEADER]: '198.51.100.7', 'x-forwarded-for': '104.16.0.1', [FORWARDER_HEADER]: 'guess' } });
    expect(seen[0]?.headers[FRONT_DOOR_HEADER]).toBe('door-token');
    expect(seen[0]?.headers[FRONT_DOOR_CLIENT_IP_HEADER]).toBe('198.51.100.7');
    expect(seen[0]?.headers[FORWARDER_HEADER]).toBeUndefined();
  });

  it('sets Host to the new service, so Cloud Run routes it', async () => {
    await call('/health');
    expect(seen[0]?.headers.host).toBe(new URL(forwarderUrl.replace(/:\d+$/, `:${(upstream.address() as AddressInfo).port}`)).host);
  });

  it('answers its own health check without calling the new service', async () => {
    const res = await call(FORWARDER_HEALTH_PATH);
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(0);
  });

  it('answers 502 when the new service can\'t be reached', async () => {
    const dead = createForwarder({ target: 'http://127.0.0.1:1', token: TOKEN });
    const url = await listen(dead);
    const res = await new Promise<number>((resolve) => request(`${url}/v1/me`, (r) => { r.resume(); resolve(r.statusCode ?? 0); }).end());
    await new Promise((done) => dead.close(done));
    expect(res).toBe(502);
  });
});

describe('readForwarderEnv', () => {
  it('needs an https FORWARD_TO origin and a 32+ character FORWARDER_TOKEN', () => {
    expect(readForwarderEnv({ FORWARD_TO: 'https://new.a.run.app', FORWARDER_TOKEN: TOKEN, PORT: '9000' })).toEqual({ target: 'https://new.a.run.app', token: TOKEN, port: 9000 });
    expect(readForwarderEnv({ FORWARD_TO: 'https://new.a.run.app', FORWARDER_TOKEN: TOKEN }).port).toBe(8787);
    expect(() => readForwarderEnv({ FORWARDER_TOKEN: TOKEN })).toThrow(/FORWARD_TO/);
    expect(() => readForwarderEnv({ FORWARD_TO: 'http://new.a.run.app', FORWARDER_TOKEN: TOKEN })).toThrow(/FORWARD_TO/);
    expect(() => readForwarderEnv({ FORWARD_TO: 'https://new.a.run.app/v1', FORWARDER_TOKEN: TOKEN })).toThrow(/FORWARD_TO/);
    expect(() => readForwarderEnv({ FORWARD_TO: 'https://new.a.run.app', FORWARDER_TOKEN: 'short' })).toThrow(/FORWARDER_TOKEN/);
  });
});
