import { describe, it, expect, beforeEach } from 'vitest';
import { useMalafatMomentStore } from '../malafatMomentStore';

/** Session-only state for the Malafat moments (MUT-190): the business-added note and the one upsell slot. */
describe('malafatMomentStore', () => {
  beforeEach(() => useMalafatMomentStore.getState().reset());

  it('remembers that a business was just added until cleared', () => {
    const store = useMalafatMomentStore.getState();
    expect(store.businessAdded).toBe(false);
    store.markBusinessAdded();
    expect(useMalafatMomentStore.getState().businessAdded).toBe(true);
    useMalafatMomentStore.getState().clearBusinessAdded();
    expect(useMalafatMomentStore.getState().businessAdded).toBe(false);
  });

  it('counts suggestions on screen, so the Go hosted card can step aside while any is shown', () => {
    const { claimSlot } = useMalafatMomentStore.getState();
    const releaseA = claimSlot();
    const releaseB = claimSlot();
    expect(useMalafatMomentStore.getState().suggestionsShown).toBe(2);
    releaseA();
    releaseA();
    expect(useMalafatMomentStore.getState().suggestionsShown).toBe(1);
    releaseB();
    expect(useMalafatMomentStore.getState().suggestionsShown).toBe(0);
  });
});
