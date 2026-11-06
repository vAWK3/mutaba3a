import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { ORG_B, fail, ok, stubApi } from '../../__tests__/harness';
import { PERIOD_DOWNLOAD_STREAM, STREAM_PATH, aboutSize, downloadProblem, periodDownloadsOn, postDownload, submitDownload } from '../periodDownload';

/** MUT-562 (D7): a period download is a hidden form POST of the ticket to the stream, into a hidden frame. */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function captureSubmits() {
  const sent: { action: string; method: string; target: string; fields: Record<string, string> }[] = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    sent.push({ action: this.getAttribute('action')!, method: this.method, target: this.target, fields: Object.fromEntries(new FormData(this) as unknown as Iterable<[string, string]>) });
  });
  return sent;
}

describe('submitDownload', () => {
  it('posts the ticket in the body, never in the URL, into a hidden frame', () => {
    const sent = captureSubmits();
    submitDownload('ticket-123');
    expect(sent).toEqual([{ action: STREAM_PATH, method: 'post', target: 'mtb3a-period-download', fields: { ticket: 'ticket-123' } }]);
    expect(sent[0]!.action).not.toContain('ticket-123');
    expect(document.querySelector('iframe[name="mtb3a-period-download"]')).toHaveAttribute('hidden');
    expect(document.querySelector('form')).toBeNull();
  });

  it('a share link’s download carries its viewer token too, and reuses the frame', () => {
    const sent = captureSubmits();
    submitDownload('t1', 'viewer-1');
    submitDownload('t2', 'viewer-1');
    expect(sent.map((s) => s.fields)).toEqual([
      { ticket: 't1', viewerToken: 'viewer-1' },
      { ticket: 't2', viewerToken: 'viewer-1' },
    ]);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
});

describe('downloadProblem', () => {
  it('maps the caps and refusals to what the person can do', () => {
    expect(downloadProblem(new ApiError(422, 'VALIDATION_FAILED', 'x', { reason: 'PERIOD_TOO_LARGE' }))).toEqual({ kind: 'tooLarge' });
    expect(downloadProblem(new ApiError(429, 'RATE_LIMITED', 'x', null, null, 120))).toEqual({ kind: 'rateLimited', minutes: 2 });
    expect(downloadProblem(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({ kind: 'unavailable' });
    expect(downloadProblem(new Error('x'))).toEqual({ kind: 'unreachable' });
  });

  it('says about how big', () => {
    expect(aboutSize(4.2 * 1024 * 1024, 'en')).toBe('4 MB');
    expect(aboutSize(300 * 1024, 'en')).toBe('300 KB');
    expect(aboutSize(10, 'en')).toBe('1 KB');
  });
});

/** MUT-561 + MUT-314: the owner download's form post, and the probe that tells whether the server has downloads on. */
describe('postDownload', () => {
  it('posts the ticket in a form body (never a URL) to the stream, then removes the form', () => {
    const seen: { method: string; action: string; ticket: string | null }[] = [];
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
      seen.push({ method: this.method, action: new URL(this.action).pathname, ticket: (this.elements.namedItem('ticket') as HTMLInputElement | null)?.value ?? null });
    });
    postDownload('t-123');
    expect(seen).toEqual([{ method: 'post', action: PERIOD_DOWNLOAD_STREAM, ticket: 't-123' }]);
    expect(document.querySelector('form')).toBeNull();
  });
});

describe('periodDownloadsOn', () => {
  it('404 (switched off) is off; a validation refusal (on, nothing minted) is on', async () => {
    stubApi({ 'GET /v1/period-downloads/ticket': () => fail(404, 'NOT_FOUND') });
    expect(await periodDownloadsOn(ORG_B)).toBe(false);
    const stub = stubApi({ 'GET /v1/period-downloads/ticket': () => fail(422, 'VALIDATION_FAILED', [{ path: ['type'] }]) });
    expect(await periodDownloadsOn(ORG_B)).toBe(true);
    expect(stub.calls[0].url.searchParams.get('type')).toBe('none');
    stubApi({ 'GET /v1/period-downloads/ticket': () => ok({}) });
    expect(await periodDownloadsOn(ORG_B)).toBe(true);
  });
});
