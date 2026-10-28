import { describe, expect, it } from 'vitest';
import { HttpOcrClient, OCR_TIMEOUT_MS, OcrReadError, scrubbed } from '../ocr-client.js';

/** MUT-441: the API's client for the receipt-ocr sidecar: the request it sends, and R10 #3's scrubbed errors. */
const SECRET = 'ZZSECRETRECEIPTWORD';
const OK_BODY = { engine: 'rapid-v5', lines: [{ text: 'Total 12.00', conf: 0.9, box: [0, 0, 10, 10], script: 'latn' }], pages: 1 };

function client(answer: (url: string, init: RequestInit) => Promise<Response>, extra: Partial<ConstructorParameters<typeof HttpOcrClient>[0]> = {}) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const ocr = new HttpOcrClient({
    baseUrl: 'http://localhost:8790/',
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return answer(url, init);
    }) as unknown as typeof fetch,
    ...extra,
  });
  return { ocr, seen };
}
const respond = (body: unknown, status = 200) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const input = { body: new Uint8Array([1, 2, 3]), contentType: 'image/png', hint: 'photo' as const };

async function failure(promise: Promise<unknown>): Promise<OcrReadError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(OcrReadError);
    return err as OcrReadError;
  }
  throw new Error('expected a failure');
}

describe('HttpOcrClient', () => {
  it('POSTs the bytes to /v1/read with the content type, the capture hint and the auth headers', async () => {
    const { ocr, seen } = client(respond(OK_BODY), { authHeaders: async () => ({ authorization: 'Bearer id-token' }) });
    expect(await ocr.read({ ...input, hint: 'scanned' })).toEqual(OK_BODY);
    expect(seen[0]!.url).toBe('http://localhost:8790/v1/read');
    expect(seen[0]!.init).toMatchObject({ method: 'POST', headers: { 'content-type': 'image/png', 'x-capture-hint': 'scanned', authorization: 'Bearer id-token' } });
    expect(seen[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(OCR_TIMEOUT_MS).toBe(35_000);
  });

  it('an unknown script is just unknown', async () => {
    const { ocr } = client(respond({ ...OK_BODY, lines: [{ ...OK_BODY.lines[0], script: 'cyrl' }] }));
    expect((await ocr.read(input)).lines[0]!.script).toBeUndefined();
  });

  it('maps the sidecar refusals: unreadable and too_large are terminal, timeout is not', async () => {
    const unreadable = await failure(client(respond({ error: 'unreadable' }, 422)).ocr.read(input));
    expect([unreadable.code, unreadable.terminal]).toEqual(['unreadable', true]);
    const tooLarge = await failure(client(respond({ error: 'too_large' }, 413)).ocr.read(input));
    expect([tooLarge.code, tooLarge.terminal]).toEqual(['too_large', true]);
    const timeout = await failure(client(respond({ error: 'timeout' }, 504)).ocr.read(input));
    expect([timeout.code, timeout.terminal]).toEqual(['timeout', false]);
    const html = await failure(client(respond('<html>Service Unavailable</html>', 503)).ocr.read(input));
    expect([html.code, html.terminal]).toEqual(['unavailable', false]);
  });

  it('a network failure is unavailable, an aborted call is timeout', async () => {
    const down = await failure(client(async () => Promise.reject(new TypeError(`fetch failed ${SECRET}`))).ocr.read(input));
    expect(down.code).toBe('unavailable');
    const slow = await failure(client(async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))).ocr.read(input));
    expect(slow.code).toBe('timeout');
  });

  for (const [name, body] of [
    ['truncated JSON', `{"engine":"x","lines":[{"text":"${SECRET}`],
    ['a shape the contract does not allow', { engine: 'x', lines: [{ text: SECRET, conf: 7, box: [0, 0, 1, 1] }], pages: 1 }],
    ['an engine name that is not a token', { ...OK_BODY, engine: `${SECRET} with spaces` }],
  ] as const) {
    it(`${name} is malformed, with a fixed message, no cause, and nothing the body said`, async () => {
      const err = await failure(client(respond(body)).ocr.read(input));
      expect(err.code).toBe('malformed');
      expect(err.message).toBe('The OCR service answered with an unexpected body');
      expect((err as { cause?: unknown }).cause).toBeUndefined();
      expect(JSON.stringify({ ...err, message: err.message, stack: err.stack })).not.toContain(SECRET);
    });
  }

  it('scrubbed() turns any throw into the code it names, and keeps an OcrReadError as it is', async () => {
    const err = await failure(scrubbed('extract_failed', () => {
      throw new Error(SECRET);
    }));
    expect(err.code).toBe('extract_failed');
    expect(err.stack).not.toContain(SECRET);
    expect((await failure(scrubbed('malformed', () => Promise.reject(new OcrReadError('timeout'))))).code).toBe('timeout');
  });
});
