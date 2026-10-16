import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WHATS_NEW_SEEN_KEY, seedSeenVersion, pendingNotes, markWhatsNewSeen } from '../whatsNewState';
import type { ReleaseNotes } from '../releaseNotes';

const NOTES: ReleaseNotes = {
  '0.1.6': { en: ['Six'], ar: ['ستة'] },
  '0.1.7': { en: ['Seven'], ar: ['سبعة'] },
};

const versions = (current: string) => pendingNotes(NOTES, current).map((n) => n.version);

describe('What’s new state (MUT-24)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  describe('seedSeenVersion', () => {
    it('on a fresh install marks the running version seen, so nothing shows', () => {
      seedSeenVersion(null, '0.1.7');
      expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('0.1.7');
      expect(versions('0.1.7')).toEqual([]);
    });

    it('on the first upgrade since What’s new existed marks the previous version seen', () => {
      seedSeenVersion('0.1.5', '0.1.7');
      expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('0.1.5');
      expect(versions('0.1.7')).toEqual(['0.1.7', '0.1.6']);
    });

    it('never moves a seen version that is already stored', () => {
      localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.6');
      seedSeenVersion('0.1.7', '0.1.7');
      expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('0.1.6');
    });
  });

  describe('pendingNotes', () => {
    it('keeps showing an upgrade’s notes on later starts until they are dismissed', () => {
      seedSeenVersion('0.1.6', '0.1.7');
      expect(versions('0.1.7')).toEqual(['0.1.7']);
      // Next start: the last-known version is now 0.1.7, but nothing was dismissed
      seedSeenVersion('0.1.7', '0.1.7');
      expect(versions('0.1.7')).toEqual(['0.1.7']);
    });

    it('shows nothing once dismissed, and stays dismissed', () => {
      seedSeenVersion('0.1.6', '0.1.7');
      markWhatsNewSeen('0.1.7');
      expect(versions('0.1.7')).toEqual([]);
      seedSeenVersion('0.1.7', '0.1.7');
      expect(versions('0.1.7')).toEqual([]);
    });

    it('shows nothing when no seen version is stored', () => {
      expect(versions('0.1.7')).toEqual([]);
    });

    it('shows nothing when storage cannot be read (private mode, blocked storage)', () => {
      localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.5');
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(versions('0.1.7')).toEqual([]);
    });
  });

  it('survives storage that throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => seedSeenVersion(null, '0.1.7')).not.toThrow();
    expect(() => markWhatsNewSeen('0.1.7')).not.toThrow();
  });
});
