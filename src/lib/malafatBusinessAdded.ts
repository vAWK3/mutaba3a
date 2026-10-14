import { getRepositories } from '../db/provider';
import { useSampleSessionStore } from '../demo/sampleSessionStore';
import { useDemoStore } from '../demo/demoStore';
import { shouldMarkBusinessAdded } from './malafatSuggestions';
import { useMalafatMomentStore } from './malafatMomentStore';

/**
 * After a business is created (MUT-190): bring up the Malafat note in Settings
 * when it is a second or later business in the person's own data. Called by
 * the business drawer after it has closed, and never throws: the save is done,
 * so a failure here only skips the note.
 */
export async function noteBusinessCreated(): Promise<void> {
  try {
    const liveBusinesses = (await getRepositories().base.businessProfiles.list()).length;
    const sample = useSampleSessionStore.getState().status !== 'none';
    const demo = useDemoStore.getState().isActive;
    if (shouldMarkBusinessAdded({ liveBusinesses, sample, demo })) {
      useMalafatMomentStore.getState().markBusinessAdded();
    }
  } catch (error) {
    console.warn('Could not check for the Malafat note:', error);
  }
}
