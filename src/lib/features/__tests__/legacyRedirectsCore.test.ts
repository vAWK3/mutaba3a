/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import { requireFeature } from '../routeGuard';

/**
 * MUT-16 AC 3: `/reports` → `/insights` and `/transactions` → `/income` keep
 * working whether or not the target area is enabled. They are unconditional
 * redirects; the insights gate then decides on the next hop.
 */
type RouteLike = { options: { beforeLoad?: (ctx: { search: Record<string, unknown> }) => unknown; component?: unknown } };
let routesByPath: Record<string, RouteLike>;

beforeAll(async () => {
  vi.stubGlobal('__BUILD_MODE__', 'desktop');
  const { router } = await import('../../../router');
  routesByPath = router.routesByPath as unknown as Record<string, RouteLike>;
});

afterEach(() => {
  resetRepositories();
});

function installAllOff() {
  const settings = { get: vi.fn(async () => ({ ...DEFAULT_SETTINGS })), update: vi.fn(async () => {}) };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
}

async function thrownBy(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('core legacy redirects stay unconditional', () => {
  it('/reports redirects to /insights with every area off, and the insights gate then bounces home', async () => {
    installAllOff();
    const route = routesByPath['/reports'];
    expect(route.options.component).toBeUndefined();
    const first = await thrownBy(() => route.options.beforeLoad!({ search: {} }));
    expect(isRedirect(first)).toBe(true);
    expect((first as { options: { to: string } }).options.to).toBe('/insights');

    const second = await thrownBy(() => requireFeature('insights')());
    expect(isRedirect(second)).toBe(true);
    expect((second as { options: { to: string } }).options.to).toBe('/');
  });

  it('/transactions redirects to /income and forwards its search, regardless of flags', async () => {
    installAllOff();
    const route = routesByPath['/transactions'];
    const thrown = await thrownBy(() => route.options.beforeLoad!({ search: { status: 'unpaid' } }));
    expect(isRedirect(thrown)).toBe(true);
    const options = (thrown as { options: { to: string; search?: Record<string, unknown> } }).options;
    expect(options.to).toBe('/income');
    expect(options.search).toEqual({ status: 'unpaid' });
  });
});
