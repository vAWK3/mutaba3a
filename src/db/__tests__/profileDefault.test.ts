import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { pickDefaultProfileId, enforceSingleDefaultProfile } from '../profileDefault';
import type { BusinessProfile } from '../../types';

/**
 * MUT-88 (review D2): exactly one active business is the default. When more
 * than one (or none) claims it, a real profile outranks a `demo_` sample one,
 * then the earliest created wins.
 */

function profile(id: string, overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id,
    name: id,
    defaultCurrency: 'USD',
    isDefault: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  } as BusinessProfile;
}

const EARLY = '2026-01-01T00:00:00.000Z';
const LATE = '2026-06-01T00:00:00.000Z';

describe('pickDefaultProfileId', () => {
  it('keeps the one default when exactly one active profile is default', () => {
    const profiles = [profile('a', { createdAt: EARLY }), profile('b', { isDefault: true, createdAt: LATE })];
    expect(pickDefaultProfileId(profiles)).toBe('b');
  });

  it('keeps a single default even when a preferred id is passed: callers flag their row first', () => {
    const profiles = [profile('a', { isDefault: true }), profile('b')];
    expect(pickDefaultProfileId(profiles, 'b')).toBe('a');
  });

  it('prefers a real profile over a demo_ one when both claim default', () => {
    const profiles = [
      profile('demo_business_profile_1', { isDefault: true, createdAt: EARLY }),
      profile('real', { isDefault: true, createdAt: LATE }),
    ];
    expect(pickDefaultProfileId(profiles)).toBe('real');
  });

  it('picks the earliest-created among two real defaults', () => {
    const profiles = [profile('late', { isDefault: true, createdAt: LATE }), profile('early', { isDefault: true, createdAt: EARLY })];
    expect(pickDefaultProfileId(profiles)).toBe('early');
  });

  it('with no default, picks the earliest real active profile, never a demo one first', () => {
    const profiles = [
      profile('demo_business_profile_1', { createdAt: EARLY }),
      profile('real-late', { createdAt: LATE }),
    ];
    expect(pickDefaultProfileId(profiles)).toBe('real-late');
  });

  it('never picks an archived profile, even a flagged or preferred one', () => {
    const profiles = [
      profile('archived', { isDefault: true, archivedAt: EARLY, createdAt: EARLY }),
      profile('active', { createdAt: LATE }),
    ];
    expect(pickDefaultProfileId(profiles)).toBe('active');
    expect(pickDefaultProfileId(profiles, 'archived')).toBe('active');
  });

  it('uses the preferred id to break a tie', () => {
    const profiles = [profile('a', { isDefault: true, createdAt: EARLY }), profile('b', { isDefault: true, createdAt: LATE })];
    expect(pickDefaultProfileId(profiles, 'b')).toBe('b');
  });

  it('returns undefined when no active profile exists', () => {
    expect(pickDefaultProfileId([])).toBeUndefined();
    expect(pickDefaultProfileId([profile('x', { archivedAt: EARLY })])).toBeUndefined();
  });
});

describe('enforceSingleDefaultProfile', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
  });
  afterEach(async () => {
    await db.businessProfiles.clear();
  });

  async function defaults() {
    return (await db.businessProfiles.toArray()).filter((p) => p.isDefault).map((p) => p.id).sort();
  }

  it('leaves exactly one default and clears the flag on archived rows', async () => {
    await db.businessProfiles.bulkAdd([
      profile('demo_business_profile_1', { isDefault: true, createdAt: EARLY }),
      profile('real', { isDefault: true, createdAt: LATE }),
      profile('gone', { isDefault: true, archivedAt: EARLY }),
    ]);

    await db.transaction('rw', db.businessProfiles, () => enforceSingleDefaultProfile(db.businessProfiles));

    expect(await defaults()).toEqual(['real']);
  });

  it('flags the earliest real profile when none is default', async () => {
    await db.businessProfiles.bulkAdd([profile('b', { createdAt: LATE }), profile('a', { createdAt: EARLY })]);

    await enforceSingleDefaultProfile(db.businessProfiles);

    expect(await defaults()).toEqual(['a']);
  });

  it('honours the preferred id', async () => {
    await db.businessProfiles.bulkAdd([profile('a', { isDefault: true, createdAt: EARLY }), profile('b', { createdAt: LATE })]);
    await db.businessProfiles.update('b', { isDefault: true });

    await enforceSingleDefaultProfile(db.businessProfiles, 'b');

    expect(await defaults()).toEqual(['b']);
  });

  it('does not touch updatedAt on rows whose flag is already right', async () => {
    await db.businessProfiles.bulkAdd([profile('a', { isDefault: true }), profile('b')]);

    await enforceSingleDefaultProfile(db.businessProfiles);

    expect((await db.businessProfiles.get('a'))?.updatedAt).toBe('2026-10-01T09:00:00.000Z');
    expect((await db.businessProfiles.get('b'))?.updatedAt).toBe('2026-10-01T09:00:00.000Z');
  });
});
