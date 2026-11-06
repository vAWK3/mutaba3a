import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG_B, fail, ok, stubApi } from '../../__tests__/harness';
import { PERIOD_DOWNLOAD_STREAM, periodDownloadsOn, postDownload } from '../periodDownload';

/** MUT-561 + MUT-314: the download's form post, and the probe that tells whether the server has downloads on. */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
