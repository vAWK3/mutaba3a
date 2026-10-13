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
  '/retainers': 'retainers',
  '/expenses': 'expenses',
  '/insights': 'insights',
  '/planning': 'planning',
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
      (['retainers', 'expenses', 'insights', 'planning', 'projects'] as FeatureKey[])
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
 * are edited in the drawer). Stale links and bookmarks land somewhere real
 * instead of the router's bare not-found, whatever the switches say.
 */
const LEGACY_REDIRECTS: Record<string, string> = {
  '/documents': '/',
  '/documents/$': '/',
  '/settings/profiles/$profileId': '/settings',
};

describe('retired routes redirect (MUT-145)', () => {
  it.each(Object.entries(LEGACY_REDIRECTS))('%s redirects to %s with every switch on', async (path, to) => {
    installFeatures({ retainers: true, expenses: true, insights: true, planning: true, projects: true });
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
});
