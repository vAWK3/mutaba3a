import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { sendPasswordNotice } from '../password-notice.js';
import type { Mailer } from '../ports.js';

const person = { id: 'u-1', email: 'rana@studio.example', locale: 'ar' as const };

describe('sendPasswordNotice', () => {
  it('sends the password-changed template in the person’s language, keyed by person and request', async () => {
    const send = vi.fn<Mailer['send']>(async () => ({ status: 'sent' as const, id: 'x' }));
    await sendPasswordNotice({ kind: 'memory', send }, pino({ level: 'silent' }), person, { first: true, signInLink: 'https://portal.example.test/', requestId: 'req-1' });
    expect(send).toHaveBeenCalledWith({
      to: 'rana@studio.example',
      template: 'password-changed',
      locale: 'ar',
      vars: { first: true, signInLink: 'https://portal.example.test/' },
      idempotencyKey: 'password-notice:u-1:req-1',
    });
  });

  it('never throws, whatever the mailer does', async () => {
    const failing: Mailer = { kind: 'resend', send: async () => ({ status: 'failed', reason: 'timeout' }) };
    const throwing: Mailer = { kind: 'resend', send: async () => { throw new Error('bug'); } };
    await expect(sendPasswordNotice(failing, pino({ level: 'silent' }), person, { first: false, signInLink: 'https://portal.example.test/', requestId: 'req-2' })).resolves.toBeUndefined();
    await expect(sendPasswordNotice(throwing, pino({ level: 'silent' }), person, { first: false, signInLink: 'https://portal.example.test/', requestId: 'req-2' })).resolves.toBeUndefined();
  });
});
