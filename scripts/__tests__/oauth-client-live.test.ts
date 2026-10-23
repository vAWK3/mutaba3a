// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { liveDocumentProblems, waitForLiveDocument, type LiveResponse } from '../oauth-client-live';

/** MUT-387: after `make release web`, the served OAuth client document is the one we published. */
const CLIENT_ID = 'https://id.example/.well-known/oauth-client.json';
const PUBLISHED = JSON.stringify({ client_id: CLIENT_ID, client_name: 'MTB3A', redirect_uris: ['http://127.0.0.1:14100/callback'] }, null, 2);
const ok = (over: Partial<LiveResponse> = {}): LiveResponse => ({
  status: 200,
  location: null,
  contentType: 'application/json',
  body: PUBLISHED,
  ...over,
});

describe('liveDocumentProblems', () => {
  it('accepts the published document served directly as JSON', () => {
    expect(liveDocumentProblems(ok(), PUBLISHED, CLIENT_ID)).toEqual([]);
  });

  it('accepts a charset on the content type and different whitespace in the body', () => {
    const compact = JSON.stringify(JSON.parse(PUBLISHED));
    expect(liveDocumentProblems(ok({ contentType: 'application/json; charset=utf-8', body: compact }), PUBLISHED, CLIENT_ID)).toEqual([]);
  });

  it('refuses any redirect, as Malafat does', () => {
    expect(liveDocumentProblems(ok({ status: 301, location: 'https://www.id.example/.well-known/oauth-client.json' }), PUBLISHED, CLIENT_ID)).toEqual([
      'answers 301 with a redirect to https://www.id.example/.well-known/oauth-client.json (Malafat refuses any 3xx)',
    ]);
  });

  it('refuses a non-200 answer', () => {
    expect(liveDocumentProblems(ok({ status: 404, contentType: 'text/html', body: '<html>' }), PUBLISHED, CLIENT_ID)).toEqual(['answers 404, not 200']);
  });

  it('refuses a document that is not served as JSON (the SPA fallback)', () => {
    expect(liveDocumentProblems(ok({ contentType: 'text/html; charset=utf-8' }), PUBLISHED, CLIENT_ID)).toEqual([
      'is served as text/html; charset=utf-8, not application/json (Malafat refuses it)',
    ]);
  });

  it('refuses a body that is not JSON', () => {
    expect(liveDocumentProblems(ok({ body: '<!doctype html>' }), PUBLISHED, CLIENT_ID)).toEqual(['is not valid JSON']);
  });

  it('refuses a client_id that is not the URL it is served from', () => {
    const old = JSON.stringify({ ...JSON.parse(PUBLISHED), client_id: 'https://old.example/.well-known/oauth-client.json' });
    expect(liveDocumentProblems(ok({ body: old }), PUBLISHED, CLIENT_ID)).toEqual([
      `declares client_id https://old.example/.well-known/oauth-client.json, not ${CLIENT_ID}`,
      'differs from public/.well-known/oauth-client.json (the release may not be live yet)',
    ]);
  });

  it('reports a stale deploy whose client_id is right but whose content differs', () => {
    const stale = JSON.stringify({ ...JSON.parse(PUBLISHED), redirect_uris: [] });
    expect(liveDocumentProblems(ok({ body: stale }), PUBLISHED, CLIENT_ID)).toEqual([
      'differs from public/.well-known/oauth-client.json (the release may not be live yet)',
    ]);
  });
});

describe('waitForLiveDocument', () => {
  function clock() {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  }

  it('returns no problems as soon as the deploy serves the published document', async () => {
    const answers = [ok({ status: 404, contentType: 'text/html', body: '' }), ok()];
    const { now, sleep } = clock();
    const result = await waitForLiveDocument({ fetchDocument: async () => answers.shift()!, published: PUBLISHED, clientId: CLIENT_ID, now, sleep, timeoutMs: 60_000, intervalMs: 15_000 });
    expect(result).toEqual({ problems: [], attempts: 2 });
  });

  it('keeps trying through network errors, then reports the last problems at the deadline', async () => {
    const { now, sleep } = clock();
    const result = await waitForLiveDocument({
      fetchDocument: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
      published: PUBLISHED,
      clientId: CLIENT_ID,
      now,
      sleep,
      timeoutMs: 30_000,
      intervalMs: 15_000,
    });
    expect(result).toEqual({ problems: ['is unreachable: getaddrinfo ENOTFOUND'], attempts: 3 });
  });

  it('checks once when there is no time to wait', async () => {
    const { now, sleep } = clock();
    const result = await waitForLiveDocument({ fetchDocument: async () => ok({ status: 500 }), published: PUBLISHED, clientId: CLIENT_ID, now, sleep, timeoutMs: 0, intervalMs: 15_000 });
    expect(result).toEqual({ problems: ['answers 500, not 200'], attempts: 1 });
  });
});
