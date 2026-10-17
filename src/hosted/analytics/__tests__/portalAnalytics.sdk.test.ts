import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The portal's consent flow against the real posthog-js (MUT-155 review F5):
 * the mocked suite proves our call order, this proves what the SDK then does
 * with the browser's storage, its consent and its random ID. Requests are
 * answered by a stubbed fetch, so nothing leaves.
 */

const { build } = vi.hoisted(() => ({ build: { key: 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' } }));
vi.mock('../../../lib/analytics/posthogKey', () => ({
  get POSTHOG_KEY() {
    return build.key;
  },
}));

const ME = 'user-1';
const sent: string[] = [];

type Module = typeof import('../portalAnalytics');
type Sdk = { get_property: (name: string) => unknown; has_opted_out_capturing: () => boolean; capture: (event: string) => unknown };

async function freshPage(): Promise<{ portal: Module; sdk: Sdk }> {
  vi.resetModules();
  const portal = await import('../portalAnalytics');
  const sdk = (await import('posthog-js')).default as unknown as Sdk;
  return { portal, sdk };
}

/** The event names in a request body (posthog-js posts JSON when compression is off). */
function eventsIn(body: unknown): string {
  if (typeof body !== 'string') return `<${typeof body}>`;
  try {
    const parsed: unknown = JSON.parse(body);
    const list = Array.isArray(parsed) ? parsed : ((parsed as { batch?: unknown[] }).batch ?? [parsed]);
    return list.map((e) => (e as { event?: string }).event).join(',');
  } catch {
    return '<unparsed>';
  }
}

const phKeys = (store: Storage) => Object.keys(store).filter((key) => /^(__)?ph_/.test(key));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${String(url)} ${eventsIn(init?.body)}`);
      return new Response('{"status":1}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(async () => {
  // posthog-js sends on a later tick: let this test's requests land before the next one counts
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.unstubAllGlobals();
});

describe('portal consent with the real SDK', () => {
  it('is opted out until the person says yes, and stores nothing before', async () => {
    const { portal, sdk } = await freshPage();
    await portal.syncPortalUsage(ME);
    expect(phKeys(localStorage)).toEqual([]);
    await portal.choosePortalUsage('on', 'first_run');
    expect(sdk.has_opted_out_capturing()).toBe(false);
    expect(sdk.get_property('$device_id')).toEqual(expect.any(String));
  });

  it('turning it off silences the SDK and leaves no PostHog key in either storage, even after another capture', async () => {
    const { portal, sdk } = await freshPage();
    await portal.syncPortalUsage(ME);
    await portal.choosePortalUsage('on', 'first_run');
    await portal.choosePortalUsage('off', 'settings');
    expect(sdk.has_opted_out_capturing()).toBe(true);
    expect(phKeys(localStorage)).toEqual([]);
    expect(phKeys(sessionStorage)).toEqual([]);
    // A stale tab still holding "on" calls capture: the SDK refuses and writes nothing back
    sdk.capture('income_recorded');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Two event posts: analytics_opted_in, then the last note, which did leave after the opt-out
    // call (request_batching is off). The stale capture added none. (The body may be a Blob, so
    // names are read only when posthog-js posts plain JSON.)
    expect(sent).toHaveLength(2);
    for (const request of sent) expect(request).toMatch(/^https:\/\/eu\.i\.posthog\.com\/e\/ (analytics_opted_in|analytics_opted_out|<object>)$/);
    expect(sent.join()).not.toContain('income_recorded');
    expect(phKeys(localStorage)).toEqual([]);
    expect(phKeys(sessionStorage)).toEqual([]);
  });

  it('turning it on again in the same page gives a fresh random ID', async () => {
    const { portal, sdk } = await freshPage();
    await portal.syncPortalUsage(ME);
    await portal.choosePortalUsage('on', 'first_run');
    const first = sdk.get_property('$device_id');
    await portal.choosePortalUsage('off', 'settings');
    await portal.choosePortalUsage('on', 'settings');
    expect(sdk.has_opted_out_capturing()).toBe(false);
    expect(sdk.get_property('$device_id')).not.toEqual(first);
  });

  it('a new page after an opt-out in another tab starts opted out, with no consent record left', async () => {
    const first = await freshPage();
    await first.portal.syncPortalUsage(ME);
    await first.portal.choosePortalUsage('on', 'first_run');
    await first.portal.choosePortalUsage('off', 'settings');
    const second = await freshPage();
    // The SDK loads in this "tab" with no consent record: it must count as opted out
    localStorage.setItem('mutaba3a-portal-usage', JSON.stringify({ owner: ME, choice: 'off' }));
    await second.portal.syncPortalUsage(ME);
    expect(phKeys(localStorage)).toEqual([]);
  });
});
