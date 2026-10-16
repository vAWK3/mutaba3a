import { generateOneTimePassword } from '../../auth/users.js';
import { CliError, type AdminClient } from '../users.js';
import { redeemSetupLink, type ApiClientDeps } from './apiClient.js';

/**
 * The admin-API half of seeding a demo account (MUT-136): get-or-create the
 * QA user, then give it a fresh password. MUT-235: the admin surface no longer
 * hands out passwords, so the script does what a person would — it asks for a
 * setup link (the same call `npm run rotate:password` makes) and sets a
 * freshly generated password through it. Doing that every run means the script
 * never has to persist a secret to disk: the returned password is always fresh
 * and always correct for the account this call just touched. Setting it signs
 * out every session, as a rotation always did. The one exception is
 * `keepPassword`, for credentials already handed out.
 */

export interface EnsureSeedAccountOptions {
  email: string;
  displayName: string;
  /** Required when the account doesn't exist yet (no organization-id → a personal-only profile, MUT-120). */
  currency: string;
  timezone: string;
  /** Drives the personal profile's own name and the expense-category preset's language (MUT-143) — both are fixed at account creation, not the in-app language picker. Ignored when the account already exists. */
  locale: 'en' | 'ar';
  /**
   * An existing account's current password, to use instead of rotating. For an
   * account whose credentials were handed to someone else (App Store / Play
   * reviewers): rotating would break them and revoke their sessions. Ignored
   * when the account doesn't exist yet — a new account has no password to keep.
   */
  keepPassword?: string | undefined;
}

export interface SeedAccountCredentials {
  userId: string;
  email: string;
  password: string;
  /** False only when `keepPassword` was used as-is. */
  rotated: boolean;
}

export async function ensureSeedAccount(admin: AdminClient, api: ApiClientDeps, options: EnsureSeedAccountOptions): Promise<SeedAccountCredentials> {
  const { userId, created } = await findOrCreate(admin, options);
  if (options.keepPassword && !created) {
    return { userId, email: options.email, password: options.keepPassword, rotated: false };
  }
  const { setupLink } = await admin.call<{ setupLink: { url: string } }>('POST', `/admin/v1/users/${userId}/setup-link`, {});
  // 24 base64url characters (144 bits): well past the 12-character floor.
  const password = generateOneTimePassword();
  await redeemSetupLink(api, setupLink.url, password);
  return { userId, email: options.email, password, rotated: true };
}

async function findOrCreate(admin: AdminClient, options: EnsureSeedAccountOptions): Promise<{ userId: string; created: boolean }> {
  try {
    return { userId: (await admin.userByEmail(options.email)).id, created: false };
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
  }
  const created = await admin.call<{ user: { id: string } }>('POST', '/admin/v1/users', {
    email: options.email,
    displayName: options.displayName,
    defaultCurrency: options.currency,
    timezone: options.timezone,
    locale: options.locale,
  });
  return { userId: created.user.id, created: true };
}
