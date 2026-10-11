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
