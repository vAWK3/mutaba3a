import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  MUTABA3A_ADMIN_TOKEN: 'x'.repeat(32),
  API_KEY_ENVIRONMENT: 'test',
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
