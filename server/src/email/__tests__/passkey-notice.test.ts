import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { passkeyAddedEvents } from '../passkey-notice.js';
import type { Mailer } from '../ports.js';
import type { PasskeyRecord, UserRecord } from '../../repositories/ports.js';

const user = { id: 'u-1', email: 'rana@studio.example', locale: 'ar' } as UserRecord;
const passkey = { id: 'pk-1', name: 'iCloud Keychain' } as PasskeyRecord;
const settings = { portalOrigin: 'https://portal.example.test' };
const event = { user, passkey, requestId: 'req-1', requestUrl: 'https://api.example.test/v1/passkeys' };

describe('passkeyAddedEvents (MUT-414)', () => {
  it('sends passkey-added in the person’s language, naming the passkey, keyed by the passkey', async () => {
    const send = vi.fn<Mailer['send']>(async () => ({ status: 'sent' as const, id: 'x' }));
    await passkeyAddedEvents({ kind: 'memory', send }, pino({ level: 'silent' }), settings).added(event);
    expect(send).toHaveBeenCalledWith({
      to: 'rana@studio.example',
      template: 'passkey-added',
      locale: 'ar',
      vars: { passkeyName: 'iCloud Keychain', signInLink: 'https://portal.example.test/' },
      idempotencyKey: 'passkey-added:pk-1',
    });
  });

  it('never throws, whatever the mailer does', async () => {
    const failing: Mailer = { kind: 'resend', send: async () => ({ status: 'failed', reason: 'timeout' }) };
    const throwing: Mailer = { kind: 'resend', send: async () => { throw new Error('bug'); } };
    await expect(passkeyAddedEvents(failing, pino({ level: 'silent' }), settings).added(event)).resolves.toBeUndefined();
    await expect(passkeyAddedEvents(throwing, pino({ level: 'silent' }), settings).added(event)).resolves.toBeUndefined();
  });
});
