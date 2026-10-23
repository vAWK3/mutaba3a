import type { BrowserContext } from '@playwright/test';

/**
 * Sentry in release-QA (MUT-149, ADR-091 am.11). The portal's QA build carries
 * a dummy DSN on the org's real ingest host (qa.config.mjs), so the crash
 * reporting code runs, and every request to any Sentry host is answered here:
 * nothing a QA run does ever reaches Sentry. Specs read what would have been
 * sent through `crashReports.events()`.
 */

export interface SentErrorEvent {
  exception?: { values?: { type?: string; value?: string }[] };
  user?: Record<string, unknown>;
  tags?: Record<string, string>;
  request?: { url?: string; headers?: Record<string, string> };
  [key: string]: unknown;
}

export interface CrashReportSpy {
  /** Every error event the pages tried to send, in order. */
  events(): SentErrorEvent[];
  /** Every request to a Sentry host at all, event or not. */
  requestCount(): number;
  /** The raw envelope text of every request, for "this never appears anywhere" checks. */
  raw(): string[];
}

/** Any Sentry host: an org's ingest host on either region, or sentry.io itself. */
const ANY_SENTRY_HOST = /^https?:\/\/([a-z0-9-]+\.)*sentry\.io\//;

/** A Sentry envelope: a header line, then a header line and a payload line per item. */
export function eventsInEnvelope(text: string): SentErrorEvent[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const events: SentErrorEvent[] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const header = JSON.parse(lines[i]) as { type?: string };
    if (header.type === 'event') events.push(JSON.parse(lines[i + 1]) as SentErrorEvent);
  }
  return events;
}

/** Answers every Sentry request in `context` and records its events. */
export async function interceptSentry(context: BrowserContext): Promise<CrashReportSpy> {
  const raw: string[] = [];
  await context.route(ANY_SENTRY_HOST, async (route) => {
    raw.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return {
    events: () =>
      raw.flatMap((text) => {
        try {
          return eventsInEnvelope(text);
        } catch {
          return [];
        }
      }),
    requestCount: () => raw.length,
    raw: () => [...raw],
  };
}
