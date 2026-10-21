import { describe, it, expect } from 'vitest';
import { ApiError } from '../../api/client';
import { mapOwnerError, mapProfileError } from '../profileApiErrors';

const err = (status: number, code: ConstructorParameters<typeof ApiError>[1], details?: unknown) => new ApiError(status, code, 'm', details ?? null);

describe('mapProfileError (ER1–ER8, design review Issue 5)', () => {
  it('ER1: PROFILE_LIMIT is an info banner with the server limit, blocks Save and re-reads me', () => {
    expect(mapProfileError(err(409, 'CONFLICT', { reason: 'PROFILE_LIMIT', limit: 6 }))).toEqual({
      banner: { tone: 'info', key: 'hosted.profiles.errors.limit', count: 6 },
      capReached: true,
      refetchMe: true,
    });
  });

  it('ER2: VERSION_MISMATCH offers Reload and re-reads me', () => {
    expect(mapProfileError(err(409, 'CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: 4 }))).toEqual({
      banner: { tone: 'error', key: 'hosted.profiles.errors.changedElsewhere' },
      conflict: true,
      refetchMe: true,
    });
  });

  it('ER3: DEFAULT_PERSONAL_PROFILE explains the lock and re-reads me', () => {
    expect(mapProfileError(err(409, 'CONFLICT', { reason: 'DEFAULT_PERSONAL_PROFILE' }))).toEqual({
      banner: { tone: 'error', key: 'hosted.profiles.errors.builtInType' },
      refetchMe: true,
    });
  });

  it('ER4: 403 NOT_OWNER sends the pane back to the list', () => {
    expect(mapProfileError(err(403, 'READ_ONLY_PROFILE', { reason: 'NOT_OWNER' }))).toEqual({
      banner: { tone: 'error', key: 'hosted.profiles.errors.notOwner' },
      refetchMe: true,
      backToList: true,
    });
  });

  it('ER5: 404 says the profile is gone and sends the pane back to the list', () => {
    expect(mapProfileError(err(404, 'NOT_FOUND'))).toEqual({
      banner: { tone: 'error', key: 'hosted.profiles.errors.gone' },
      refetchMe: true,
      backToList: true,
    });
  });

  it('ER6: a validation error with a known field goes inline on that field', () => {
    expect(mapProfileError(err(422, 'VALIDATION_FAILED', { field: 'name' }))).toEqual({ field: { field: 'name', key: 'hosted.profiles.errors.nameInvalid' } });
    expect(mapProfileError(err(422, 'VALIDATION_FAILED', { field: 'timezone' }))).toEqual({ field: { field: 'timezone', key: 'hosted.profiles.errors.timezoneInvalid' } });
    expect(mapProfileError(err(422, 'VALIDATION_FAILED', { field: 'defaultCurrency' }))).toEqual({ field: { field: 'defaultCurrency', key: 'hosted.profiles.errors.currencyInvalid' } });
  });

  it('ER7: offline (or no ApiError at all) says nothing was saved', () => {
    expect(mapProfileError(err(0, 'NETWORK'))).toEqual({ banner: { tone: 'error', key: 'hosted.profiles.errors.network' } });
    expect(mapProfileError(new Error('boom'))).toEqual({ banner: { tone: 'error', key: 'hosted.profiles.errors.network' } });
  });

  it('ER8: anything else, including a validation error with no field, is a generic banner', () => {
    expect(mapProfileError(err(422, 'VALIDATION_FAILED', {}))).toEqual({ banner: { tone: 'error', key: 'hosted.profiles.errors.generic' } });
    expect(mapProfileError(err(500, 'INTERNAL'))).toEqual({ banner: { tone: 'error', key: 'hosted.profiles.errors.generic' } });
  });
});

describe('co-owners (MUT-373)', () => {
  it('names another owner in a version conflict on a shared profile (DR7)', () => {
    expect(mapProfileError(err(409, 'CONFLICT', { reason: 'VERSION_MISMATCH' }), true).banner?.key).toBe('hosted.profiles.errors.changedByOwner');
  });

  it('explains CO_OWNED and re-reads me', () => {
    expect(mapProfileError(err(409, 'CONFLICT', { reason: 'CO_OWNED' }))).toEqual({ banner: { tone: 'error', key: 'hosted.profiles.errors.coOwned' }, refetchMe: true });
  });

  it('maps a leave or removal refusal to a banner in the section, never a toast (DR5)', () => {
    expect(mapOwnerError(err(409, 'CONFLICT', { reason: 'CREATOR_CANNOT_LEAVE' })).banner?.key).toBe('hosted.profiles.owners.creatorCannotLeave');
    expect(mapOwnerError(err(403, 'READ_ONLY_PROFILE', { reason: 'NOT_CREATOR' })).banner?.key).toBe('hosted.profiles.owners.notCreator');
    expect(mapOwnerError(new ApiError(0, 'NETWORK', 'm', null))).toEqual({ banner: { tone: 'error', key: 'hosted.profiles.errors.network' } });
  });

  it('treats someone already gone as done: refetch, then the toast (DR5)', () => {
    expect(mapOwnerError(err(404, 'NOT_FOUND'))).toEqual({ done: true, refetchMe: true });
  });
});
