import { describe, expect, it, vi } from 'vitest';
import { MailTransportError, type OutgoingMail } from '../ports.js';
import { createResendTransport, RESEND_EMAILS_URL } from '../transports/resend.js';

/**
 * MUT-359 A2: the request Resend gets. Open and click tracking are a domain setting in Resend (email:check
 * asserts them off); the send request must carry nothing but the mail itself, so no tracking or tagging option
 * can ever ride along. Nothing here reaches the network: fetch is stubbed.
 */
const MAIL: OutgoingMail = {
  to: 'rana@studio.example',
  from: 'MTB3A <no-reply@mail.example.test>',
  replyTo: 'help@example.test',
  template: 'password-changed',
  locale: 'ar',
  subject: 'Subject',
  text: 'Text',
  html: '<!doctype html><html lang="ar" dir="rtl"></html>',
  idempotencyKey: 'a'.repeat(64),
};

function stubFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}
const ok = () => new Response(JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Resend transport', () => {
  it('posts exactly the mail: no tracking, tags or custom headers', async () => {
    const fetch = stubFetch(ok());
    const transport = createResendTransport({ apiKey: 're_test_key', fetch });
    await expect(transport.deliver(MAIL)).resolves.toEqual({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(RESEND_EMAILS_URL);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['from', 'html', 'reply_to', 'subject', 'text', 'to']);
    expect(body.to).toEqual(['rana@studio.example']);
    expect(body.reply_to).toBe('help@example.test');
    expect(JSON.stringify(body)).not.toMatch(/track|tag|header/i);

    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer re_test_key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe('a'.repeat(64));
  });

  it('leaves reply_to out when there is none', async () => {
    const fetch = stubFetch(ok());
    await createResendTransport({ apiKey: 're_test_key', fetch }).deliver({ ...MAIL, replyTo: null });
    expect(Object.keys(JSON.parse(String(fetch.mock.calls[0]![1]?.body)))).not.toContain('reply_to');
  });

  it.each([
    [429, 'rate_limited'],
    [422, 'rejected'],
    [401, 'rejected'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i to %s, with Resend’s error name but never its key', async (status, reason) => {
    const fetch = stubFetch(new Response(JSON.stringify({ name: 'validation_error', message: 'Invalid `to` field' }), { status }));
    const error = await createResendTransport({ apiKey: 're_test_key', fetch }).deliver(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailTransportError);
    expect((error as MailTransportError).reason).toBe(reason);
    expect((error as MailTransportError).status).toBe(status);
    expect((error as Error).message).not.toContain('re_test_key');
  });

  it('reports a timeout when Resend takes longer than the budget', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const error = await createResendTransport({ apiKey: 're_test_key', fetch, timeoutMs: 20 }).deliver(MAIL).catch((e: unknown) => e);
    expect((error as MailTransportError).reason).toBe('timeout');
  });

  it('reports a network failure, and a 2xx without an id as unavailable', async () => {
    const down = await createResendTransport({ apiKey: 're_test_key', fetch: stubFetch(new TypeError('fetch failed')) }).deliver(MAIL).catch((e: unknown) => e);
    expect((down as MailTransportError).reason).toBe('network');
    const odd = await createResendTransport({ apiKey: 're_test_key', fetch: stubFetch(new Response('{}', { status: 200 })) }).deliver(MAIL).catch((e: unknown) => e);
    expect((odd as MailTransportError).reason).toBe('unavailable');
  });
});
