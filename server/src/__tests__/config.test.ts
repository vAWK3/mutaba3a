import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config.js';
import { UNOWNED_DOMAINS } from '../email/ports.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  MUTABA3A_ADMIN_TOKEN: 'x'.repeat(32),
  API_KEY_ENVIRONMENT: 'test',
  SESSION_TOKEN_PEPPER: 's'.repeat(32),
};

describe('loadConfig — argon2 parameters (MUT-37)', () => {
  it('defaults to OWASP argon2id profile 1', () => {
    const config = loadConfig(base);
    expect(config.ARGON2_MEMORY_KIB).toBe(19456);
    expect(config.ARGON2_TIME_COST).toBe(2);
    expect(config.ARGON2_PARALLELISM).toBe(1);
  });

  it('accepts values above the minimums', () => {
    const config = loadConfig({ ...base, ARGON2_MEMORY_KIB: '65536', ARGON2_TIME_COST: '3', ARGON2_PARALLELISM: '2' });
    expect(config).toMatchObject({ ARGON2_MEMORY_KIB: 65536, ARGON2_TIME_COST: 3, ARGON2_PARALLELISM: 2 });
  });

  it.each([
    ['ARGON2_MEMORY_KIB', '19455'],
    ['ARGON2_TIME_COST', '1'],
    ['ARGON2_PARALLELISM', '0'],
  ])('refuses %s=%s at boot, naming the variable', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });
});

describe('loadConfig — sessions (MUT-38)', () => {
  it('requires a session pepper of at least 32 characters', () => {
    const { SESSION_TOKEN_PEPPER: _omit, ...withoutPepper } = base;
    void _omit;
    expect(() => loadConfig(withoutPepper)).toThrow('SESSION_TOKEN_PEPPER');
    expect(() => loadConfig({ ...base, SESSION_TOKEN_PEPPER: 'short' })).toThrow('SESSION_TOKEN_PEPPER');
  });

  it('defaults idle to 120 minutes, absolute to 12 hours, one trusted proxy hop, no portal origin', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ SESSION_IDLE_MINUTES: 120, SESSION_ABSOLUTE_HOURS: 12, TRUSTED_PROXY_HOPS: 1 });
    expect(config.PORTAL_ORIGIN).toBeUndefined();
  });

  it.each([
    ['SESSION_IDLE_MINUTES', '4'],
    ['SESSION_IDLE_MINUTES', '1441'],
    ['SESSION_ABSOLUTE_HOURS', '0'],
    ['SESSION_ABSOLUTE_HOURS', '169'],
    ['TRUSTED_PROXY_HOPS', '6'],
    ['PORTAL_ORIGIN', 'not a url'],
  ])('refuses %s=%s', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });

  it('accepts a portal origin', () => {
    expect(loadConfig({ ...base, PORTAL_ORIGIN: 'https://portal.example.com' }).PORTAL_ORIGIN).toBe('https://portal.example.com');
  });
});

describe('loadConfig — placeholder secrets (MUT-472, ADR-211)', () => {
  const PLACEHOLDER = 'replace-with-32-plus-random-characters-from-secret-manager';

  it.each(['MUTABA3A_ADMIN_TOKEN', 'SESSION_TOKEN_PEPPER', 'FRONT_DOOR_TOKEN', 'MUTABA3A_JOB_TOKEN', 'OAUTH_DERIVE_KEY'])(
    'refuses the .env.example placeholder as %s, naming the variable',
    (name) => {
      const env = { ...base, PORTAL_ORIGIN: 'https://portal.example.com', [name]: PLACEHOLDER };
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(`${name}: ${name} is the placeholder from server/.env.example`);
    },
  );

  it('refuses the admin token exactly as server/.env.example ships it', () => {
    const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
    const shipped = /^MUTABA3A_ADMIN_TOKEN=(.+)$/m.exec(example)?.[1];
    expect(shipped).toBeDefined();
    expect(() => loadConfig({ ...base, MUTABA3A_ADMIN_TOKEN: shipped })).toThrow(/MUTABA3A_ADMIN_TOKEN is the placeholder/);
  });

  it('matches the prefix in any case', () => {
    expect(() => loadConfig({ ...base, SESSION_TOKEN_PEPPER: PLACEHOLDER.toUpperCase() })).toThrow(/SESSION_TOKEN_PEPPER is the placeholder/);
  });

  it('accepts a real secret, even one with the words later on', () => {
    const token = `${'a'.repeat(32)}-replace-with-`;
    expect(loadConfig({ ...base, MUTABA3A_ADMIN_TOKEN: token }).MUTABA3A_ADMIN_TOKEN).toBe(token);
  });
});

describe('loadConfig — custom-domain front door (MUT-326)', () => {
  const door = { PORTAL_ORIGIN: 'https://app.placeholder.example', FRONT_DOOR_TOKEN: 't'.repeat(48) };

  it('has no front door and no redirect by default', () => {
    const config = loadConfig(base);
    expect(config.FRONT_DOOR_TOKEN).toBeUndefined();
    expect(config.PORTAL_LEGACY_REDIRECT).toBe(false);
  });

  it('accepts a token with the portal origin it serves', () => {
    expect(loadConfig({ ...base, ...door }).FRONT_DOOR_TOKEN).toBe(door.FRONT_DOOR_TOKEN);
  });

  it('refuses a short token', () => {
    expect(() => loadConfig({ ...base, ...door, FRONT_DOOR_TOKEN: 'short' })).toThrow(/FRONT_DOOR_TOKEN/);
  });

  it('refuses a token without PORTAL_ORIGIN', () => {
    expect(() => loadConfig({ ...base, FRONT_DOOR_TOKEN: door.FRONT_DOOR_TOKEN })).toThrow(/needs PORTAL_ORIGIN/);
  });

  it('reads PORTAL_LEGACY_REDIRECT="false" as off (z.coerce.boolean would read it as on)', () => {
    expect(loadConfig({ ...base, ...door, PORTAL_LEGACY_REDIRECT: 'false' }).PORTAL_LEGACY_REDIRECT).toBe(false);
    expect(loadConfig({ ...base, ...door, PORTAL_LEGACY_REDIRECT: 'true' }).PORTAL_LEGACY_REDIRECT).toBe(true);
  });

  it.each(['1', 'yes', 'TRUE', ''])('refuses PORTAL_LEGACY_REDIRECT=%j', (value) => {
    expect(() => loadConfig({ ...base, ...door, PORTAL_LEGACY_REDIRECT: value })).toThrow(/PORTAL_LEGACY_REDIRECT/);
  });

  it('refuses the redirect without the front door', () => {
    expect(() => loadConfig({ ...base, PORTAL_LEGACY_REDIRECT: 'true' })).toThrow(/needs FRONT_DOOR_TOKEN/);
  });
});

describe('loadConfig — passkeys (MUT-115 D2)', () => {
  it('has no passkeys by default', () => {
    expect(loadConfig(base).WEBAUTHN_RP_ID).toBeUndefined();
  });

  it('accepts the apex with the portal on a subdomain', () => {
    expect(loadConfig({ ...base, WEBAUTHN_RP_ID: 'placeholder.example', PORTAL_ORIGIN: 'https://app.placeholder.example' }).WEBAUTHN_RP_ID).toBe('placeholder.example');
  });

  it('refuses a portal origin outside the RP ID, and origins without an RP ID', () => {
    expect(() => loadConfig({ ...base, WEBAUTHN_RP_ID: 'placeholder.example', PORTAL_ORIGIN: 'https://service.a.run.example' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, WEBAUTHN_ORIGINS: 'http://localhost:5173' })).toThrow(/needs WEBAUTHN_RP_ID/);
  });

  it('takes an explicit localhost list for local QA', () => {
    expect(loadConfig({ ...base, WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGINS: 'http://localhost:8791,https://localhost' }).WEBAUTHN_ORIGINS).toBe('http://localhost:8791,https://localhost');
  });
});

describe('loadConfig — receipts library switch (MUT-389)', () => {
  it('enforces the lapse gate unless BILLING_GATE is exactly "false" (MUT-361 D7 kill switch)', () => {
    expect(loadConfig(base).BILLING_GATE).toBe(true);
    expect(loadConfig({ ...base, BILLING_GATE: 'true' }).BILLING_GATE).toBe(true);
    expect(loadConfig({ ...base, BILLING_GATE: 'false' }).BILLING_GATE).toBe(false);
  });

  it('is off unless RECEIPTS_LIBRARY is exactly "true"; "false" is off (z.coerce.boolean would read it as on)', () => {
    expect(loadConfig(base).RECEIPTS_LIBRARY).toBe(false);
    expect(loadConfig({ ...base, RECEIPTS_LIBRARY: 'false' }).RECEIPTS_LIBRARY).toBe(false);
    expect(loadConfig({ ...base, RECEIPTS_LIBRARY: 'true' }).RECEIPTS_LIBRARY).toBe(true);
  });

  it.each(['1', 'yes', 'TRUE', ''])('refuses RECEIPTS_LIBRARY=%j', (value) => {
    expect(() => loadConfig({ ...base, RECEIPTS_LIBRARY: value })).toThrow(/RECEIPTS_LIBRARY/);
  });
});

describe('loadConfig — device sessions (MUT-64)', () => {
  it('defaults idle to 30 days, absolute to 180 days', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ DEVICE_SESSION_IDLE_DAYS: 30, DEVICE_SESSION_ABSOLUTE_DAYS: 180 });
  });

  it.each([
    ['DEVICE_SESSION_IDLE_DAYS', '0'],
    ['DEVICE_SESSION_IDLE_DAYS', '366'],
    ['DEVICE_SESSION_ABSOLUTE_DAYS', '0'],
    ['DEVICE_SESSION_ABSOLUTE_DAYS', '731'],
  ])('refuses %s=%s', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });
});

describe('loadConfig — portal serving (MUT-45)', () => {
  it('defaults to no portal dist dir (API-only)', () => {
    expect(loadConfig(base).PORTAL_DIST_DIR).toBeUndefined();
  });

  it('accepts a portal dist dir path', () => {
    expect(loadConfig({ ...base, PORTAL_DIST_DIR: '/app/portal' }).PORTAL_DIST_DIR).toBe('/app/portal');
  });

  it('refuses an empty PORTAL_DIST_DIR', () => {
    expect(() => loadConfig({ ...base, PORTAL_DIST_DIR: '' })).toThrow('PORTAL_DIST_DIR');
  });
});

describe('loadConfig — app association files (MUT-111)', () => {
  const appAssociation = {
    APPLE_TEAM_ID: '4LCWA596X7',
    APPLE_BUNDLE_ID: 'com.barmajiyat.mutaba3a',
    ANDROID_PACKAGE_NAME: 'com.barmajiyat.mutaba3a',
    ANDROID_SHA256_FINGERPRINTS: 'AA:BB:CC,DD:EE:FF',
  };

  it('defaults to none set (feature off)', () => {
    const config = loadConfig(base);
    expect(config.APPLE_TEAM_ID).toBeUndefined();
    expect(config.APPLE_BUNDLE_ID).toBeUndefined();
    expect(config.ANDROID_PACKAGE_NAME).toBeUndefined();
    expect(config.ANDROID_SHA256_FINGERPRINTS).toBeUndefined();
  });

  it('accepts all four set', () => {
    const config = loadConfig({ ...base, ...appAssociation });
    expect(config).toMatchObject(appAssociation);
  });

  it.each([
    ['APPLE_TEAM_ID'],
    ['APPLE_BUNDLE_ID'],
    ['ANDROID_PACKAGE_NAME'],
    ['ANDROID_SHA256_FINGERPRINTS'],
  ])('refuses %s set alone, naming it an all-or-nothing group', (missing) => {
    const partial = { ...appAssociation };
    delete (partial as Record<string, string>)[missing];
    expect(() => loadConfig({ ...base, ...partial })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ...partial })).toThrow('APPLE_TEAM_ID, APPLE_BUNDLE_ID, ANDROID_PACKAGE_NAME, ANDROID_SHA256_FINGERPRINTS');
  });

  it('refuses an empty string for any one of them', () => {
    expect(() => loadConfig({ ...base, ...appAssociation, APPLE_TEAM_ID: '' })).toThrow(ConfigError);
  });

  it.each([[','], [' , '], [',,']])(
    'refuses ANDROID_SHA256_FINGERPRINTS=%j — passes schema validation but trims/filters to zero fingerprints',
    (fingerprints) => {
      // A typo'd list like "," is a non-empty string (passes min(1)) but every
      // entry is blank once well-known.ts trims and filters it — the server
      // would otherwise boot fine and silently serve assetlinks.json with an
      // empty sha256_cert_fingerprints array, which Android's verifier rejects
      // with no error surfaced anywhere.
      expect(() => loadConfig({ ...base, ...appAssociation, ANDROID_SHA256_FINGERPRINTS: fingerprints })).toThrow(
        'ANDROID_SHA256_FINGERPRINTS',
      );
    },
  );
});

describe('loadConfig — minimum app version (MUT-293)', () => {
  it('defaults to no floor configured on either platform, check not disabled', () => {
    const config = loadConfig(base);
    expect(config.IOS_MIN_BUILD).toBeUndefined();
    expect(config.ANDROID_MIN_BUILD).toBeUndefined();
    expect(config.IOS_RECOMMENDED_BUILD).toBeUndefined();
    expect(config.ANDROID_RECOMMENDED_BUILD).toBeUndefined();
    expect(config.MIN_BUILD_CHECK_DISABLED).toBe(false);
  });

  it('accepts a floor and a recommended build per platform', () => {
    const config = loadConfig({ ...base, IOS_MIN_BUILD: '10', IOS_RECOMMENDED_BUILD: '12', ANDROID_MIN_BUILD: '5', ANDROID_RECOMMENDED_BUILD: '5' });
    expect(config).toMatchObject({ IOS_MIN_BUILD: 10, IOS_RECOMMENDED_BUILD: 12, ANDROID_MIN_BUILD: 5, ANDROID_RECOMMENDED_BUILD: 5 });
  });

  it('accepts the kill switch', () => {
    expect(loadConfig({ ...base, MIN_BUILD_CHECK_DISABLED: 'true' }).MIN_BUILD_CHECK_DISABLED).toBe(true);
  });

  it('reads MIN_BUILD_CHECK_DISABLED="false" as a working gate (MUT-457: z.coerce.boolean read it as off)', () => {
    expect(loadConfig({ ...base, MIN_BUILD_CHECK_DISABLED: 'false' }).MIN_BUILD_CHECK_DISABLED).toBe(false);
  });

  it.each(['1', 'yes', 'TRUE', ''])('refuses MIN_BUILD_CHECK_DISABLED=%j', (value) => {
    expect(() => loadConfig({ ...base, MIN_BUILD_CHECK_DISABLED: value })).toThrow(/MIN_BUILD_CHECK_DISABLED/);
  });

  it.each([
    ['IOS_MIN_BUILD', '0'],
    ['IOS_MIN_BUILD', '-1'],
    ['IOS_MIN_BUILD', 'not-a-number'],
    ['ANDROID_RECOMMENDED_BUILD', '0'],
  ])('refuses %s=%s at boot, naming the variable', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });

  it('refuses a recommended build below the floor on the same platform', () => {
    expect(() => loadConfig({ ...base, IOS_MIN_BUILD: '10', IOS_RECOMMENDED_BUILD: '9' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, IOS_MIN_BUILD: '10', IOS_RECOMMENDED_BUILD: '9' })).toThrow('IOS_RECOMMENDED_BUILD');
  });

  it('does not cross-check recommended/floor across different platforms', () => {
    expect(loadConfig({ ...base, IOS_MIN_BUILD: '10', ANDROID_RECOMMENDED_BUILD: '1' })).toMatchObject({ IOS_MIN_BUILD: 10, ANDROID_RECOMMENDED_BUILD: 1 });
  });
});

describe('loadConfig — reference exchange rates (MUT-228)', () => {
  it('defaults to Frankfurter, a 4-hour window and a 3-second timeout', () => {
    expect(loadConfig(base)).toMatchObject({
      FX_RATES_URL: 'https://api.frankfurter.dev/v1/latest',
      FX_RATES_TTL_MINUTES: 240,
      FX_RATES_TIMEOUT_MS: 3000,
    });
  });

  it('accepts values inside the bounds', () => {
    const config = loadConfig({ ...base, FX_RATES_URL: 'http://localhost:9999/latest', FX_RATES_TTL_MINUTES: '15', FX_RATES_TIMEOUT_MS: '10000' });
    expect(config).toMatchObject({ FX_RATES_URL: 'http://localhost:9999/latest', FX_RATES_TTL_MINUTES: 15, FX_RATES_TIMEOUT_MS: 10000 });
    expect(loadConfig({ ...base, FX_RATES_TTL_MINUTES: '1440', FX_RATES_TIMEOUT_MS: '500' })).toMatchObject({ FX_RATES_TTL_MINUTES: 1440, FX_RATES_TIMEOUT_MS: 500 });
  });

  it('accepts plain http only for a local stub', () => {
    expect(loadConfig({ ...base, FX_RATES_URL: 'http://127.0.0.1:9999/latest' }).FX_RATES_URL).toBe('http://127.0.0.1:9999/latest');
    expect(loadConfig({ ...base, FX_RATES_URL: 'http://localhost/latest' }).FX_RATES_URL).toBe('http://localhost/latest');
  });

  it.each([
    ['FX_RATES_URL', 'not a url'],
    ['FX_RATES_URL', 'http://api.frankfurter.dev/v1/latest'],
    ['FX_RATES_URL', 'ftp://localhost/latest'],
    ['FX_RATES_TTL_MINUTES', '14'],
    ['FX_RATES_TTL_MINUTES', '1441'],
    ['FX_RATES_TIMEOUT_MS', '499'],
    ['FX_RATES_TIMEOUT_MS', '10001'],
  ])('refuses %s=%s at boot, naming the variable', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });
});

describe('loadConfig — Stripe and the job token (MUT-360)', () => {
  const stripe = { STRIPE_SECRET_KEY: 'rk_test_mut360', STRIPE_WEBHOOK_SECRET: 'whsec_mut360' };

  it('has no Stripe and no job token by default', () => {
    const config = loadConfig(base);
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
    expect(config.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(config.MUTABA3A_JOB_TOKEN).toBeUndefined();
  });

  it('accepts a restricted or secret test key with its webhook secret', () => {
    expect(loadConfig({ ...base, ...stripe }).STRIPE_SECRET_KEY).toBe('rk_test_mut360');
    expect(loadConfig({ ...base, ...stripe, STRIPE_SECRET_KEY: 'sk_test_x' }).STRIPE_SECRET_KEY).toBe('sk_test_x');
  });

  it('wants both Stripe values or neither', () => {
    expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: stripe.STRIPE_SECRET_KEY })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...base, STRIPE_WEBHOOK_SECRET: stripe.STRIPE_WEBHOOK_SECRET })).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('refuses values that are not a Stripe key or a webhook secret', () => {
    expect(() => loadConfig({ ...base, ...stripe, STRIPE_SECRET_KEY: 'pk_test_publishable' })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadConfig({ ...base, ...stripe, STRIPE_WEBHOOK_SECRET: 'secret' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('refuses a live key outside the live environment, and accepts it in it', () => {
    expect(() => loadConfig({ ...base, ...stripe, STRIPE_SECRET_KEY: 'rk_live_x' })).toThrow(/live Stripe key/);
    expect(loadConfig({ ...base, API_KEY_ENVIRONMENT: 'live', ...stripe, STRIPE_SECRET_KEY: 'rk_live_x' }).STRIPE_SECRET_KEY).toBe('rk_live_x');
  });

  it('a live server takes only a restricted live key: no full-access key, no test key (MUT-360 review)', () => {
    const live = { ...base, API_KEY_ENVIRONMENT: 'live', ...stripe };
    expect(() => loadConfig({ ...live, STRIPE_SECRET_KEY: 'sk_live_full_access' })).toThrow(/restricted live key/);
    expect(() => loadConfig({ ...live, STRIPE_SECRET_KEY: 'rk_test_x' })).toThrow(/restricted live key/);
    expect(loadConfig({ ...base, ...stripe, STRIPE_SECRET_KEY: 'sk_test_local' }).STRIPE_SECRET_KEY).toBe('sk_test_local');
  });

  it('wants a job token of at least 32 characters', () => {
    expect(loadConfig({ ...base, MUTABA3A_JOB_TOKEN: 'j'.repeat(32) }).MUTABA3A_JOB_TOKEN).toBe('j'.repeat(32));
    expect(() => loadConfig({ ...base, MUTABA3A_JOB_TOKEN: 'short' })).toThrow(/MUTABA3A_JOB_TOKEN/);
  });
});

describe('loadConfig — Sentry (MUT-148, ADR-091)', () => {
  const EU_DSN = 'https://publickey@o4501.ingest.de.sentry.io/4502';

  it('leaves Sentry off when SENTRY_DSN is unset', () => {
    expect(loadConfig(base).SENTRY_DSN).toBeUndefined();
  });

  it('accepts an EU-region DSN', () => {
    expect(loadConfig({ ...base, SENTRY_DSN: EU_DSN }).SENTRY_DSN).toBe(EU_DSN);
  });

  it.each([
    ['a US-region DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502'],
    ['a DSN with no region', 'https://publickey@o4501.ingest.sentry.io/4502'],
    ['plain http', 'http://publickey@o4501.ingest.de.sentry.io/4502'],
    ['not a DSN', 'sentry'],
  ])('refuses %s at boot, naming SENTRY_DSN', (_label, dsn) => {
    expect(() => loadConfig({ ...base, SENTRY_DSN: dsn })).toThrow(/SENTRY_DSN/);
  });

  it('reports under NODE_ENV unless SENTRY_ENVIRONMENT names another environment', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).SENTRY_ENVIRONMENT).toBe('production');
    expect(loadConfig({ ...base, NODE_ENV: 'production', SENTRY_ENVIRONMENT: 'operator' }).SENTRY_ENVIRONMENT).toBe('operator');
  });
});

describe('loadConfig — mail (MUT-359)', () => {
  const resend = {
    MAILER: 'resend',
    MAIL_FROM_ADDRESS: 'no-reply@mail.example.test',
    MAIL_REPLY_TO: 'help@example.test',
    RESEND_API_KEY: 're_test_mut359',
    RESEND_WEBHOOK_SECRET: 'whsec_bXV0MzU5LXNlY3JldA==',
    MAIL_DAILY_CAP: '90',
    // MUT-366 (review #6): a server that really sends mail names its Turnstile secret (here, Cloudflare's test one).
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  };

  it('defaults to no mailer, signup off, a 500 cap with a 10 % security reserve and 10 per recipient', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ MAILER: 'noop', SELF_SIGNUP_ENABLED: false, MAIL_DAILY_CAP: 500, MAIL_SECURITY_RESERVE: 50, MAIL_RECIPIENT_DAILY_CAP: 10 });
    expect(config.RESEND_API_KEY).toBeUndefined();
  });

  it('starts with every Resend value set, and rounds the reserve up', () => {
    expect(loadConfig({ ...base, ...resend })).toMatchObject({ MAILER: 'resend', MAIL_DAILY_CAP: 90, MAIL_SECURITY_RESERVE: 9 });
    expect(loadConfig({ ...base, ...resend, MAIL_DAILY_CAP: '95' }).MAIL_SECURITY_RESERVE).toBe(10);
    expect(loadConfig({ ...base, ...resend, MAIL_SECURITY_RESERVE: '0' }).MAIL_SECURITY_RESERVE).toBe(0);
    // Terraform accepts a cap of 1: it boots with no reserve rather than refusing.
    expect(loadConfig({ ...base, ...resend, MAIL_DAILY_CAP: '1' })).toMatchObject({ MAIL_DAILY_CAP: 1, MAIL_SECURITY_RESERVE: 0 });
  });

  it.each(['MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MAIL_DAILY_CAP'])('refuses MAILER=resend without %s', (name) => {
    const env: Record<string, string> = { ...base, ...resend };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('refuses noop while self-signup is on', () => {
    expect(() => loadConfig({ ...base, SELF_SIGNUP_ENABLED: 'true' })).toThrow('SELF_SIGNUP_ENABLED');
    expect(loadConfig({ ...base, SELF_SIGNUP_ENABLED: 'true', MAILER: 'memory' }).SELF_SIGNUP_ENABLED).toBe(true);
    expect(loadConfig({ ...base, SELF_SIGNUP_ENABLED: 'false' }).SELF_SIGNUP_ENABLED).toBe(false);
  });

  it.each(['log', 'memory'])('refuses MAILER=%s in production, where links would land in logs or nowhere', (mailer) => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MAILER: mailer })).toThrow('MAILER');
    expect(loadConfig({ ...base, NODE_ENV: 'development', MAILER: mailer }).MAILER).toBe(mailer);
  });

  it('refuses an unowned domain as the sender or the reply-to', () => {
    expect(() => loadConfig({ ...base, ...resend, MAIL_FROM_ADDRESS: `no-reply@${UNOWNED_DOMAINS[0]}` })).toThrow('MAIL_FROM_ADDRESS');
    expect(() => loadConfig({ ...base, ...resend, MAIL_REPLY_TO: `help@${UNOWNED_DOMAINS[0]}` })).toThrow('MAIL_REPLY_TO');
  });

  it('allows the webhook secret alone, but only with the sender address it filters events by', () => {
    expect(() => loadConfig({ ...base, RESEND_WEBHOOK_SECRET: resend.RESEND_WEBHOOK_SECRET })).toThrow('MAIL_FROM_ADDRESS');
    expect(loadConfig({ ...base, RESEND_WEBHOOK_SECRET: resend.RESEND_WEBHOOK_SECRET, MAIL_FROM_ADDRESS: resend.MAIL_FROM_ADDRESS }).MAILER).toBe('noop');
  });

  it('refuses malformed keys, secrets and caps', () => {
    expect(() => loadConfig({ ...base, ...resend, RESEND_API_KEY: 'sk_live_x' })).toThrow('RESEND_API_KEY');
    expect(() => loadConfig({ ...base, ...resend, RESEND_WEBHOOK_SECRET: 'secret' })).toThrow('RESEND_WEBHOOK_SECRET');
    expect(() => loadConfig({ ...base, ...resend, MAIL_DAILY_CAP: '0' })).toThrow('MAIL_DAILY_CAP');
    expect(() => loadConfig({ ...base, ...resend, MAIL_SECURITY_RESERVE: '90' })).toThrow('MAIL_SECURITY_RESERVE');
    expect(() => loadConfig({ ...base, MAIL_FROM_ADDRESS: 'MTB3A <no-reply@mail.example.test>' })).toThrow('MAIL_FROM_ADDRESS');
  });

  it('MUT-468: WEBSITE_ORIGIN (the Privacy link in every mail) is an https origin and nothing more', () => {
    expect(loadConfig({ ...base, WEBSITE_ORIGIN: 'https://site.example.test' }).WEBSITE_ORIGIN).toBe('https://site.example.test');
    expect(loadConfig(base).WEBSITE_ORIGIN).toBeUndefined();
    for (const bad of ['http://site.example.test', 'https://site.example.test/', 'https://site.example.test/privacy', 'https://site.example.test?x=1', 'site.example.test', 'https://']) {
      expect(() => loadConfig({ ...base, WEBSITE_ORIGIN: bad }), bad).toThrow('WEBSITE_ORIGIN');
    }
  });

  it('MUT-468: production mail needs PORTAL_ORIGIN, where the mail art is served; WEBSITE_ORIGIN stays optional', () => {
    const production = { ...base, NODE_ENV: 'production', ...resend, TURNSTILE_SECRET: '0x4AAAAAAAmut468livesecretforconfigtests' };
    expect(() => loadConfig(production)).toThrow('PORTAL_ORIGIN');
    expect(loadConfig({ ...production, PORTAL_ORIGIN: 'https://app.example.test' }).WEBSITE_ORIGIN).toBeUndefined();
    // The art origin must be an https origin there, or every mail would point at broken or mixed-content pictures.
    for (const bad of ['http://app.example.test', 'HTTPS://APP.EXAMPLE.TEST', 'https://app.example.test/portal']) {
      expect(() => loadConfig({ ...production, PORTAL_ORIGIN: bad }), bad).toThrow('PORTAL_ORIGIN');
    }
    // Outside production a mail without art is fine (development, QA, tests render the images-off layout).
    expect(loadConfig({ ...base, ...resend }).PORTAL_ORIGIN).toBeUndefined();
  });
});

describe('loadConfig — signup and recovery (MUT-366)', () => {
  const resend = {
    MAILER: 'resend',
    MAIL_FROM_ADDRESS: 'no-reply@mail.example.test',
    MAIL_REPLY_TO: 'help@example.test',
    RESEND_API_KEY: 're_test_mut366',
    RESEND_WEBHOOK_SECRET: 'whsec_bXV0MzY2LXNlY3JldA==',
    MAIL_DAILY_CAP: '90',
  };
  const LIVE_TURNSTILE = '0x4AAAAAAAmut366livesecretforconfigtests';

  it('defaults the floors to ADR-159’s 3000 and 1500 ms, and Turnstile to Cloudflare’s always-pass test secret outside production', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ SIGNUP_RESPONSE_FLOOR_MS: 3000, RECOVERY_RESPONSE_FLOOR_MS: 1500, TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' });
    expect(loadConfig({ ...base, SIGNUP_RESPONSE_FLOOR_MS: '4000', RECOVERY_RESPONSE_FLOOR_MS: '2000' })).toMatchObject({ SIGNUP_RESPONSE_FLOOR_MS: 4000, RECOVERY_RESPONSE_FLOOR_MS: 2000 });
  });

  it('keeps a floor between 0 and 10 seconds', () => {
    expect(() => loadConfig({ ...base, SIGNUP_RESPONSE_FLOOR_MS: '20000' })).toThrow('SIGNUP_RESPONSE_FLOOR_MS');
    expect(() => loadConfig({ ...base, RECOVERY_RESPONSE_FLOOR_MS: '-1' })).toThrow('RECOVERY_RESPONSE_FLOOR_MS');
  });

  it('lets QA choose the always-fail test secret outside production', () => {
    expect(loadConfig({ ...base, TURNSTILE_SECRET: '2x0000000000000000000000000000000AA' }).TURNSTILE_SECRET).toBe('2x0000000000000000000000000000000AA');
  });

  it('production needs a real Turnstile secret once mail or signup is on, and never a test one', () => {
    // MUT-468: production mail also needs PORTAL_ORIGIN (the mail art's origin).
    const production = { ...base, NODE_ENV: 'production', PORTAL_ORIGIN: 'https://app.example.test' };
    expect(loadConfig(production).TURNSTILE_SECRET).toBeUndefined();
    expect(() => loadConfig({ ...production, ...resend })).toThrow('TURNSTILE_SECRET');
    expect(loadConfig({ ...production, ...resend, TURNSTILE_SECRET: LIVE_TURNSTILE }).TURNSTILE_SECRET).toBe(LIVE_TURNSTILE);
    expect(() => loadConfig({ ...production, ...resend, TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' })).toThrow('TURNSTILE_SECRET');
  });

  it('any server that really sends mail needs an explicit Turnstile secret, staging included (review #6)', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging', ...resend })).toThrow('TURNSTILE_SECRET');
    expect(loadConfig({ ...base, NODE_ENV: 'staging', ...resend, TURNSTILE_SECRET: LIVE_TURNSTILE }).TURNSTILE_SECRET).toBe(LIVE_TURNSTILE);
  });
});

describe('loadConfig — signup domain checker (MUT-367, D3)', () => {
  it('asks DNS in production and the fixture elsewhere, unless told; production refuses the fixture', () => {
    expect(loadConfig(base).EMAIL_DOMAIN_CHECKER).toBe('fixture');
    expect(loadConfig({ ...base, EMAIL_DOMAIN_CHECKER: 'dns' }).EMAIL_DOMAIN_CHECKER).toBe('dns');
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).EMAIL_DOMAIN_CHECKER).toBe('dns');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', EMAIL_DOMAIN_CHECKER: 'fixture' })).toThrow('EMAIL_DOMAIN_CHECKER');
  });
});

describe('loadConfig — attachment storage (MUT-396)', () => {
  it('leaves storage unset by default and resolves the local folder under the server package', () => {
    const config = loadConfig(base);
    expect(config.ATTACHMENTS_DRIVER).toBeUndefined();
    expect(config.ATTACHMENTS_DIR.endsWith('/server/.data/attachments')).toBe(true);
  });

  it('accepts the local driver in development and test, and keeps an absolute folder as given', () => {
    expect(loadConfig({ ...base, ATTACHMENTS_DRIVER: 'local' }).ATTACHMENTS_DRIVER).toBe('local');
    expect(loadConfig({ ...base, NODE_ENV: 'test', ATTACHMENTS_DRIVER: 'local', ATTACHMENTS_DIR: '/tmp/receipts' }).ATTACHMENTS_DIR).toBe('/tmp/receipts');
  });

  it.each(['production', 'staging'])('refuses the local driver in %s', (env) => {
    expect(() => loadConfig({ ...base, NODE_ENV: env, ATTACHMENTS_DRIVER: 'local' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NODE_ENV: env, ATTACHMENTS_DRIVER: 'local' })).toThrow(/ATTACHMENTS_DRIVER: local storage is for the dev server/);
  });

  it('refuses local together with a bucket, and gcs without one', () => {
    expect(() => loadConfig({ ...base, ATTACHMENTS_DRIVER: 'local', ATTACHMENTS_BUCKET: 'my-bucket' })).toThrow(/ambiguous/);
    expect(() => loadConfig({ ...base, ATTACHMENTS_DRIVER: 'gcs' })).toThrow(/gcs needs ATTACHMENTS_BUCKET/);
    expect(loadConfig({ ...base, ATTACHMENTS_DRIVER: 'gcs', ATTACHMENTS_BUCKET: 'my-bucket' }).ATTACHMENTS_DRIVER).toBe('gcs');
  });
});

describe('loadConfig — listen address (MUT-463)', () => {
  it('leaves HOST unset by default, so the server keeps Node’s all-interface bind', () => {
    expect(loadConfig(base).HOST).toBeUndefined();
  });

  it.each(['127.0.0.1', '::1', '0.0.0.0', '::'])('accepts the IP address %s', (host) => {
    expect(loadConfig({ ...base, HOST: host }).HOST).toBe(host);
  });

  // A name binds to its first resolved address (localhost is ::1 first on macOS), so only IP literals are accepted.
  it.each(['', 'localhost', 'my-mac.local', '256.1.1.1', '127.0.0.1:8787', '[::1]', ' 127.0.0.1'])(
    'refuses HOST=%j at boot, naming the variable',
    (host) => {
      expect(() => loadConfig({ ...base, HOST: host })).toThrow(ConfigError);
      expect(() => loadConfig({ ...base, HOST: host })).toThrow(/HOST: must be an IP address, such as 127\.0\.0\.1/);
    },
  );
});

describe('loadConfig — local QA profile cap (MUT-474)', () => {
  it('leaves the cap override unset by default', () => {
    expect(loadConfig(base).QA_MAX_OWNED_PROFILES).toBeUndefined();
  });

  it('accepts an override in development and test', () => {
    expect(loadConfig({ ...base, QA_MAX_OWNED_PROFILES: '100' }).QA_MAX_OWNED_PROFILES).toBe(100);
    expect(loadConfig({ ...base, NODE_ENV: 'test', QA_MAX_OWNED_PROFILES: '8' }).QA_MAX_OWNED_PROFILES).toBe(8);
  });

  it('refuses an override below the product limit', () => {
    expect(() => loadConfig({ ...base, QA_MAX_OWNED_PROFILES: '3' })).toThrow(ConfigError);
  });

  it.each(['production', 'staging'])('refuses an override in %s', (env) => {
    expect(() => loadConfig({ ...base, NODE_ENV: env, QA_MAX_OWNED_PROFILES: '100' })).toThrow(/QA_MAX_OWNED_PROFILES: the profile cap override is for the dev server and local QA only/);
  });
});
