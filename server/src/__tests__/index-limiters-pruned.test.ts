import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A SlidingWindowRateLimiter keeps a window per key until pruned. The server builds its limiters in index.ts and drops
 * idle keys on a timer; a limiter built anywhere else (or left out of the timer) grows with every new key, which an
 * attacker chooses (an address, a client_id). MUT-434 review finding 3: the OAuth limiters were built in createApp.
 */
describe('index.ts prunes every limiter it builds', () => {
  const source = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
  const built = [...source.matchAll(/^const (\w+) = (?:new SlidingWindowRateLimiter|defaultOAuthLimiters)\(/gm)].map((m) => m[1] ?? '');

  it('finds the limiters', () => {
    expect(built).toEqual(expect.arrayContaining(['rateLimiter', 'signInIpLimiter', 'oauthLimiters', 'agentLimiter']));
  });

  it('each one appears in the prune timer', () => {
    const timer = /const pruneTimer = setInterval\(\(\) => \{([\s\S]*?)\}, 60_000\);/.exec(source)?.[1] ?? '';
    for (const name of built) expect(timer.includes(`${name}.prune(now)`) || timer.includes(`Object.values(${name})`), name).toBe(true);
  });

  it('the server hands createApp its OAuth limiters, so createApp builds none of its own', () => {
    expect(source).toMatch(/oauth: config\.OAUTH_DERIVE_KEY \? \{[^}]*limiters: oauthLimiters, agentLimiter \}/);
  });
});
