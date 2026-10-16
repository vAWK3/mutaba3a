/**
 * MUT-235: the operator surface no longer hands out passwords, so a test that
 * needs a signed-in person provisions them and sets a password the way the
 * person would, through their setup link. One place, instead of every suite
 * knowing the setup flow.
 */

interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

/** The password every provisioned test person ends up with unless a test picks another. */
export const SETUP_TEST_PASSWORD = 'correct-horse-battery-staple';

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';

/** `Origin` equal to the request's own, which is what the portal sends (app.request URLs are http://localhost). */
const SAME_ORIGIN = { origin: 'http://localhost' };

const post = (body: unknown, headers: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** The token from a setup link: it rides in the URL fragment. */
export function setupTokenOf(url: string): string {
  return new URL(url).hash.slice(1);
}

export async function redeemSetupLink(app: RequestableApp, url: string, password = SETUP_TEST_PASSWORD): Promise<void> {
  const res = await app.request('/v1/account-setup', post({ token: setupTokenOf(url), password }, SAME_ORIGIN));
  if (res.status !== 200) throw new Error(`redeeming the setup link failed: ${res.status} ${await res.text()}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreatedUser = any;

/**
 * POST /admin/v1/users, then redeems the setup link it returns. Resolves to the
 * create response plus `password`, the one now set. Throws unless both succeed.
 */
export async function provisionUser(
  app: RequestableApp,
  body: Record<string, unknown>,
  options: { password?: string; adminToken?: string } = {},
): Promise<CreatedUser> {
  const res = await app.request('/admin/v1/users', post(body, { 'x-admin-token': options.adminToken ?? ADMIN_TOKEN }));
  const created = (await res.json()) as CreatedUser;
  if (res.status !== 201) throw new Error(`provisioning failed: ${res.status} ${JSON.stringify(created)}`);
  const password = options.password ?? SETUP_TEST_PASSWORD;
  await redeemSetupLink(app, created.setupLink.url, password);
  return { ...created, password };
}
