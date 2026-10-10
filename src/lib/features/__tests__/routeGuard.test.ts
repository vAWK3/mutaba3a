import { describe, it, expect, afterEach, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import type { Settings } from '../../../types';
import { requireFeature } from '../routeGuard';

function installFakeSettings(initial: Partial<Settings> = {}) {
  const row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = { get: vi.fn(async () => ({ ...row })), update: vi.fn(async () => {}) };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return settings;
}

async function thrownBy(fn: () => Promise<void>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  resetRepositories();
});

describe('requireFeature', () => {
  it('redirects to home while the area is off', async () => {
    installFakeSettings();
    const error = await thrownBy(requireFeature('invoices'));
    expect(error).toBeDefined();
    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe('/');
  });

  it('lets the navigation through when the area is on', async () => {
    installFakeSettings({ features: { invoices: true } });
    await expect(requireFeature('invoices')()).resolves.toBeUndefined();
  });

  it('honours a custom redirect target', async () => {
    installFakeSettings();
    const error = await thrownBy(requireFeature('retainers', '/clients'));
    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe('/clients');
  });

  it('treats a pre-v20 settings row (no features) as off', async () => {
    const settings = installFakeSettings();
    settings.get.mockResolvedValueOnce({ ...DEFAULT_SETTINGS });
    const error = await thrownBy(requireFeature('retainers'));
    expect(isRedirect(error)).toBe(true);
  });

  it('reads the flag on every call, so a toggle is honoured by the next navigation', async () => {
    const settings = installFakeSettings();
    const guard = requireFeature('invoices');
    expect(isRedirect(await thrownBy(guard))).toBe(true);
    settings.get.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, features: { invoices: true } });
    await expect(guard()).resolves.toBeUndefined();
    expect(settings.get).toHaveBeenCalledTimes(2);
  });
});
