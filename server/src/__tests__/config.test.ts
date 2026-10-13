import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config.js';

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
    expect(loadConfig({ ...base, PORTAL_ORIGIN: 'https://portal.mutaba3a.app' }).PORTAL_ORIGIN).toBe('https://portal.mutaba3a.app');
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
});
