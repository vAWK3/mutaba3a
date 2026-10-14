import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  HONEYPOT_FIELD,
  HOSTED_REQUEST_FIELDS,
  HOSTED_REQUEST_FORM_NAME,
  NETLIFY_FORMS_PATH,
  SUBMIT_TIMEOUT_MS,
  emptyHostedRequest,
  encodeHostedRequest,
  submitHostedRequest,
  validateHostedRequest,
  type HostedRequestValues,
} from '../hostedRequest';

function values(overrides: Partial<HostedRequestValues> = {}): HostedRequestValues {
  return { ...emptyHostedRequest('en'), name: 'Lina Haddad', email: 'lina@example.com', ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('validateHostedRequest', () => {
  it('accepts a name and an email with every optional field empty', () => {
    expect(validateHostedRequest(values())).toEqual({});
  });

  it('requires a name and an email', () => {
    expect(validateHostedRequest(values({ name: '', email: '' }))).toEqual({ name: true, email: true });
  });

  it('counts whitespace-only answers as empty', () => {
    expect(validateHostedRequest(values({ name: '   ', email: '\t ' }))).toEqual({ name: true, email: true });
  });

  it.each(['lina@', 'lina', 'lina@example', '@example.com', 'li na@example.com'])('rejects %j as an email', (email) => {
    expect(validateHostedRequest(values({ email }))).toEqual({ email: true });
  });

  it('accepts an email with spaces around it, since they are trimmed before sending', () => {
    expect(validateHostedRequest(values({ email: '  lina@example.com ' }))).toEqual({});
  });
});

describe('encodeHostedRequest', () => {
  it('names the Netlify form and sends exactly the declared fields, in order', () => {
    const body = encodeHostedRequest(values());
    expect([...body.keys()]).toEqual(['form-name', ...HOSTED_REQUEST_FIELDS]);
    expect(body.get('form-name')).toBe(HOSTED_REQUEST_FORM_NAME);
  });

  it('trims every typed answer', () => {
    const body = encodeHostedRequest(values({ name: '  Lina ', email: ' lina@example.com ', phone: ' +970 59 ', message: ' hi \n' }));
    expect(body.get('name')).toBe('Lina');
    expect(body.get('email')).toBe('lina@example.com');
    expect(body.get('phone')).toBe('+970 59');
    expect(body.get('message')).toBe('hi');
  });

  it('joins the chosen devices into one value', () => {
    expect(encodeHostedRequest(values({ devices: ['iphone', 'computer'] })).get('devices')).toBe('iphone, computer');
    expect(encodeHostedRequest(values({ devices: [] })).get('devices')).toBe('');
  });

  it('sends the page language so the reply can be in it (D4)', () => {
    expect(encodeHostedRequest(values({ language: 'ar' })).get('language')).toBe('ar');
  });

  it('sends the honeypot as typed: empty for people, filled for bots Netlify then drops', () => {
    expect(encodeHostedRequest(values()).get(HONEYPOT_FIELD)).toBe('');
    expect(encodeHostedRequest(values({ honeypot: 'http://spam.test' })).get(HONEYPOT_FIELD)).toBe('http://spam.test');
  });

  it('sends the profession code, not its label', () => {
    expect(encodeHostedRequest(values({ profession: 'lawyer' })).get('profession')).toBe('lawyer');
  });
});

describe('submitHostedRequest', () => {
  const ok = () => Promise.resolve(new Response(null, { status: 200 }));

  it('posts url-encoded form data to the static form file, which no SPA rewrite catches', async () => {
    const fetchImpl = vi.fn(ok);
    await expect(submitHostedRequest(values(), fetchImpl)).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(NETLIFY_FORMS_PATH);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(init.body).toBe(encodeHostedRequest(values()).toString());
  });

  it('reports an error when Netlify answers with a failure status', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    await expect(submitHostedRequest(values(), fetchImpl)).resolves.toBe('error');
  });

  it('reports an error when the request cannot be made at all', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(submitHostedRequest(values(), fetchImpl)).resolves.toBe('error');
  });

  it('gives up after the timeout, aborting the request, so the visitor gets the retry state (D5)', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const result = submitHostedRequest(values(), fetchImpl);
    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('error');
    expect(signal?.aborted).toBe(true);
  });

  it('waits 15 seconds before giving up', () => {
    expect(SUBMIT_TIMEOUT_MS).toBe(15_000);
  });
});
