/**
 * Mutaba3a front door (MUT-326, ADR-155): a Cloudflare Worker on `<portal>.<domain>/*`
 * that forwards to the Cloud Run service (the legacy run.app origin), the way Malafat's
 * malafat-router does. Cloud Run domain mapping isn't offered in me-west1.
 *
 * It changes nothing but two headers: it proves itself to the server with
 * FRONT_DOOR_TOKEN and hands over the address Cloudflare read at its edge, so the
 * server keys sign-in throttling by the real caller (server/src/auth/sessions.ts,
 * requestClientIp). Those two names are overwritten, never trusted from the caller.
 * Everything else (method, body, headers such as X-Mutaba3a-Profile, the server's
 * redirects and Set-Cookie) passes through untouched.
 *
 * Bindings (server/infrastructure/frontdoor/main.tf): UPSTREAM_ORIGIN (plain text),
 * FRONT_DOOR_TOKEN (secret text). Tested by scripts/__tests__/front-door-worker.test.ts.
 */
const FRONT_DOOR_HEADER = 'x-mutaba3a-front-door';
const CLIENT_IP_HEADER = 'x-mutaba3a-client-ip';

export default {
  async fetch(request, env) {
    if (!env.FRONT_DOOR_TOKEN || !env.UPSTREAM_ORIGIN) {
      return new Response('Mutaba3a front door is not configured', { status: 503 });
    }
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    // The upstream URL sets Host; Cloud Run answers only its own.
    headers.delete('host');
    headers.delete(CLIENT_IP_HEADER);
    headers.set(FRONT_DOOR_HEADER, env.FRONT_DOOR_TOKEN);
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);

    const init = { method: request.method, headers, redirect: 'manual' };
    // A GET or HEAD with a body is a TypeError in fetch (Malafat MAL-322).
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
    return fetch(new URL(url.pathname + url.search, env.UPSTREAM_ORIGIN), init);
  },
};
