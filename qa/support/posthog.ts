import { gunzipSync } from 'node:zlib';
import type { BrowserContext, Page, Request } from '@playwright/test';

/**
 * PostHog in release-QA (MUT-154/155, ADR-090). QA builds carry a dummy `phc_`
 * key (qa.config.mjs) so the analytics code runs, and every request to
 * PostHog is answered here: nothing a QA run does ever reaches PostHog. Specs
 * read what would have been sent through `analytics.events()`.
 */

export const POSTHOG_ORIGIN = 'https://eu.i.posthog.com';

export interface SentEvent {
  event: string;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

/** posthog-js posts JSON, a base64 `data=` form, or gzip; this reads all three. */
export function decodePosthogBody(request: Request): SentEvent[] {
  const buffer = request.postDataBuffer();
  if (!buffer || buffer.length === 0) return [];
  let text: string;
  try {
    text = gunzipSync(buffer).toString('utf8');
  } catch {
    text = buffer.toString('utf8');
  }
  if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8');
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : (parsed as { batch?: unknown[] }).batch ?? [parsed];
  return list as SentEvent[];
}

export interface AnalyticsSpy {
  /** Every event the pages tried to send, in order. */
  events(): SentEvent[];
  /** How many requests went to PostHog at all (events or not). */
  requestCount(): number;
}

/**
 * posthog-js drops every event from an automated browser (`navigator.webdriver`,
 * or a "HeadlessChrome" brand in `navigator.userAgentData`), which is right for
 * crawlers in production. Specs that read analytics run as an ordinary
 * browser, before any page script.
 */
export async function actAsPerson(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
  });
}

/** Answers every PostHog request in `context` and records its events. */
export async function interceptPosthog(context: BrowserContext): Promise<AnalyticsSpy> {
  const events: SentEvent[] = [];
  let requests = 0;
  await context.route(`${POSTHOG_ORIGIN}/**`, async (route) => {
    requests += 1;
    try {
      events.push(...decodePosthogBody(route.request()));
    } catch {
      // A non-event request (there should be none: flags and remote config are off) is still counted
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  return { events: () => [...events], requestCount: () => requests };
}
