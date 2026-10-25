import type { SessionSettings } from '../auth/middleware.js';
import type { Logger } from '../logger.js';
import type { PasskeyEvents } from '../routes/passkeys.js';
import { signInLinkOf } from '../routes/account-setup.js';
import type { Mailer } from './ports.js';

/**
 * MUT-414: "a passkey was added to your account", after every `user.passkey_added`. Passkeys survive a password
 * change, so someone who knew the password could plant one; this mail is how the owner finds out. Told after the add
 * committed (the `PasskeyEvents` seam), and it never throws, so a mail problem can't turn a successful add into an
 * error. Like `sendPasswordNotice`, outcomes other than `sent` are logged by the mailer where they matter and go to
 * debug here.
 */
export function passkeyAddedEvents(mailer: Mailer, logger: Logger, settings: Pick<SessionSettings, 'portalOrigin'>): PasskeyEvents {
  return {
    async added({ user, passkey, requestUrl }) {
      try {
        const result = await mailer.send({
          to: user.email,
          template: 'passkey-added',
          locale: user.locale,
          vars: { passkeyName: passkey.name, signInLink: signInLinkOf(settings, requestUrl) },
          // One mail per passkey: its id never repeats.
          idempotencyKey: `passkey-added:${passkey.id}`,
        });
        if (result.status !== 'sent') logger.debug({ userId: user.id, outcome: result.status }, 'passkey notice not sent');
      } catch (err) {
        logger.error({ err, userId: user.id }, 'passkey notice failed');
      }
    },
  };
}
