import type { BrowserContext } from '@playwright/test';

/**
 * The landing's signup door in release-QA (MUT-369). The landing asks the portal origin's `GET /v1/self-service`
 * whether signup is open; in the `web` app that origin is production's, so every such request is answered here and no
 * QA run ever reaches it. Closed by default (today's page). The answer carries `Access-Control-Allow-Origin: *` as the
 * server's does: Chromium applies CORS to fulfilled routes too, so without it the landing would read "closed".
 * The portal's own /signup page, opened in a new tab by "Create an account", is answered with a stand-in page, so
 * the spec can check where the button led without loading production.
 */

export type DoorState = 'open' | 'closed' | 'unreachable';

export interface SignupDoor {
  set(state: DoorState): void;
  /** How many times the page asked. */
  requests(): number;
}

const DOORS_PATH = '/v1/self-service';
const SIGNUP_PATH = '/signup';

export async function answerSignupDoor(context: BrowserContext, ownOrigin: string): Promise<SignupDoor> {
  let state: DoorState = 'closed';
  let asked = 0;
  const crossSite = (url: URL) => url.origin !== new URL(ownOrigin).origin;

  await context.route(
    (url) => crossSite(url) && url.pathname === DOORS_PATH,
    async (route) => {
      asked += 1;
      if (state === 'unreachable') return route.abort('connectionrefused');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ signup: state === 'open', recovery: true }),
      });
    },
  );
  await context.route(
    (url) => crossSite(url) && url.pathname === SIGNUP_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Portal signup (QA stand-in)</title></head><body><h1>Portal signup (QA stand-in)</h1></body></html>',
      }),
  );
  return { set: (next) => void (state = next), requests: () => asked };
}
