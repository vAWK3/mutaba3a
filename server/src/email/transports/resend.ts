import { ALLOWED_MAIL_HEADERS } from '../unsubscribe.js';
import { MailTransportError, type MailTransport, type OutgoingMail } from '../ports.js';

/**
 * MUT-359 (ADR-159 §5, D3, D15): Resend's REST send, over fetch.
 *
 * The body is the mail and nothing else: from, to, subject, html, text, reply_to. Open and click tracking are a
 * setting on the Resend domain, and `email:check --api` fails while either is on; no option here can turn them
 * on. The Idempotency-Key is the mailer's digest of the caller's key, so Resend drops a repeat within its 24 h.
 * One attempt within `timeoutMs`, never a blind retry: a timed-out send may still have been accepted.
 */
export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
export const RESEND_TIMEOUT_MS = 5000;

export interface ResendTransportOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function createResendTransport(options: ResendTransportOptions): MailTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS;

  return {
    kind: 'resend',
    async deliver(mail: OutgoingMail) {
      const body = {
        from: mail.from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        ...headersOf(mail),
      };
      let res: Response;
      try {
        res = await fetchImpl(RESEND_EMAILS_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', 'idempotency-key': mail.idempotencyKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') throw new MailTransportError('timeout', `Resend did not answer within ${timeoutMs} ms`);
        throw new MailTransportError('network', `Resend could not be reached (${name || 'error'})`);
      }
      if (!res.ok) {
        const reason = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'unavailable' : 'rejected';
        throw new MailTransportError(reason, `Resend answered ${res.status}${await errorNameOf(res)}`, res.status);
      }
      const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof json?.id !== 'string' || json.id.length === 0) throw new MailTransportError('unavailable', 'Resend accepted the mail without an id');
      return { id: json.id };
    },
  };
}

/** ADR-279: only the unsubscribe headers pass; anything else a caller adds is dropped (MUT-359 A2: nothing rides along). */
function headersOf(mail: OutgoingMail): { headers?: Record<string, string> } {
  const allowed = Object.entries(mail.headers ?? {}).filter(([name]) => (ALLOWED_MAIL_HEADERS as readonly string[]).includes(name));
  return allowed.length > 0 ? { headers: Object.fromEntries(allowed) } : {};
}

/** Resend's `{ name }` (e.g. validation_error), never its message, which may echo addresses. */
async function errorNameOf(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { name?: unknown } | null;
  return typeof json?.name === 'string' ? ` ${json.name.slice(0, 60)}` : '';
}
