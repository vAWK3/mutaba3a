import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../db/provider';
import { createMockBusinessProfile } from '../../test/utils';
import { useMalafatMomentStore } from '../malafatMomentStore';
import { useSampleSessionStore } from '../../demo/sampleSessionStore';
import { useDemoStore } from '../../demo/demoStore';
import { noteBusinessCreated } from '../malafatBusinessAdded';

function installBusinesses(list: () => Promise<unknown[]>) {
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, businessProfiles: { ...real.base.businessProfiles, list } } } as Repositories);
}

beforeEach(() => {
  useMalafatMomentStore.getState().reset();
  useSampleSessionStore.setState({ status: 'none' });
  useDemoStore.setState({ isActive: false });
});
afterEach(() => {
  resetRepositories();
  vi.restoreAllMocks();
});

/** What the business drawer does after a create (MUT-190): mark the Malafat note for a second or later business. */
describe('noteBusinessCreated', () => {
  it('marks a business created while another already exists', async () => {
    installBusinesses(async () => [createMockBusinessProfile(), createMockBusinessProfile()]);
    await noteBusinessCreated();
    expect(useMalafatMomentStore.getState().businessAdded).toBe(true);
  });

  it('never marks the first business, nor inside the visitor sample or demo data', async () => {
    installBusinesses(async () => [createMockBusinessProfile()]);
    await noteBusinessCreated();
    expect(useMalafatMomentStore.getState().businessAdded).toBe(false);
    installBusinesses(async () => [createMockBusinessProfile(), createMockBusinessProfile()]);
    useDemoStore.setState({ isActive: true });
    await noteBusinessCreated();
    expect(useMalafatMomentStore.getState().businessAdded).toBe(false);
  });

  it('never throws into the save flow: a failed read just skips the note', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installBusinesses(async () => {
      throw new Error('blocked');
    });
    await expect(noteBusinessCreated()).resolves.toBeUndefined();
    expect(useMalafatMomentStore.getState().businessAdded).toBe(false);
  });
});
