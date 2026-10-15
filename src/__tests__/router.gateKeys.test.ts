/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../db/provider';
import { DEFAULT_SETTINGS } from '../db/defaultSettings';
import type { FeatureKey } from '../types';

/**
 * Which switch each gated route reads (MUT-13/14/16). `router.gates.test`
 * proves a guard exists; this proves it reads the *right* key: with every
 * area off the route redirects home, and with only its own key on it admits.
 */
const GATE_KEYS: Record<string, FeatureKey> = {
  '/expenses': 'expenses',
  '/insights': 'insights',
  '/projects': 'projects',
  '/projects/$projectId': 'projects',
};

type RouteLike = { options: { beforeLoad?: (ctx: { search: Record<string, unknown> }) => unknown } };
let routesByPath: Record<string, RouteLike>;

beforeAll(async () => {
  vi.stubGlobal('__BUILD_MODE__', 'desktop');
  const { router } = await import('../router');
  routesByPath = router.routesByPath as unknown as Record<string, RouteLike>;
});

afterEach(() => {
  resetRepositories();
});

function installFeatures(features: Partial<Record<FeatureKey, boolean>>) {
  const settings = { get: vi.fn(async () => ({ ...DEFAULT_SETTINGS, features })), update: vi.fn(async () => {}) };
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

describe('each gated route reads its own switch', () => {
  it.each(Object.entries(GATE_KEYS))('%s redirects home with every area off', async (path) => {
    installFeatures({});
    const thrown = await thrownBy(() => routesByPath[path].options.beforeLoad!({ search: {} }));
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/');
  });

  it.each(Object.entries(GATE_KEYS))('%s admits with only %s on', async (path, key) => {
    installFeatures({ [key]: true });
    const thrown = await thrownBy(() => routesByPath[path].options.beforeLoad!({ search: {} }));
    expect(thrown).toBeUndefined();
  });

  it.each(Object.entries(GATE_KEYS))('%s still redirects when every switch but %s is on', async (path, key) => {
    const others = Object.fromEntries(
      (['expenses', 'insights', 'projects', 'conversions'] as FeatureKey[])
        .filter((k) => k !== key)
        .map((k) => [k, true]),
    ) as Partial<Record<FeatureKey, boolean>>;
    installFeatures(others);
    const thrown = await thrownBy(() => routesByPath[path].options.beforeLoad!({ search: {} }));
    expect(isRedirect(thrown)).toBe(true);
  });
});

/**
 * MUT-145 retired document generation and the profile detail page (profiles
 * are edited in the drawer); MUT-226 retired Planning and the local Retainers
 * area. Stale links and bookmarks land somewhere real instead of the router's
 * bare not-found, whatever the switches say.
 */
const LEGACY_REDIRECTS: Record<string, string> = {
  '/documents': '/',
  '/documents/$': '/',
  '/settings/profiles/$profileId': '/settings',
  '/planning': '/',
  '/retainers': '/',
};

describe('retired routes redirect (MUT-145, MUT-226)', () => {
  it.each(Object.entries(LEGACY_REDIRECTS))('%s redirects to %s with every switch on', async (path, to) => {
    installFeatures({ expenses: true, insights: true, projects: true, conversions: true });
    expect(routesByPath[path]).toBeDefined();
    const thrown = await thrownBy(() => routesByPath[path].options.beforeLoad!({ search: {} }));
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe(to);
  });

  it('no route renders a document page any more', () => {
    for (const path of ['/documents/new', '/documents/$documentId', '/documents/$documentId/edit']) {
      expect(routesByPath[path]).toBeUndefined();
    }
  });

  it.each([
    ['/planning', { plan: 'p1', scenario: 's1' }],
    ['/retainers', { status: 'active', clientId: 'c1' }],
  ])('%s renders nothing and drops a bookmarked search on the way home (MUT-226)', async (path, search) => {
    const route = routesByPath[path] as RouteLike & { options: { component?: unknown } };
    expect(route.options.component).toBeUndefined();
    const thrown = await thrownBy(() => route.options.beforeLoad!({ search }));
    expect((thrown as { options: { to: string; search?: unknown } }).options).toEqual(expect.objectContaining({ to: '/' }));
    expect((thrown as { options: { search?: unknown } }).options.search).toBeUndefined();
  });
});
