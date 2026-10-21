import { describe, it, expect } from 'vitest';
import { listOfNames } from '../useProfileKind';
import { requestedLine } from '../firmRequestLine';
import { profile } from '../../__tests__/harness';

/** MUT-373: the shared cue's list of names (DR12) and who asked for firm features (DR13). */
describe('listOfNames', () => {
  it('joins names the way each language does', () => {
    expect(listOfNames(['Sara'], 'en')).toBe('Sara');
    expect(listOfNames(['Sara', 'Omar'], 'en')).toBe('Sara and Omar');
    expect(listOfNames(['سارة', 'عمر'], 'ar')).toBe('سارة وعمر');
  });
});

describe('requestedLine', () => {
  const t = (key: string, vars: Record<string, string>) => `${key}|${Object.values(vars).join('|')}`;
  const base = profile({ owned: true, writerOfRecord: null, type: 'BUSINESS', firmRequestedAt: '2026-10-20T09:00:00Z' });

  it('says who asked, you, or — from an older server — nobody', () => {
    expect(requestedLine({ ...base, firmRequestedBy: { userId: 'u2', name: 'Basel' } }, 'u1', t, 'Oct 20')).toBe('hosted.profiles.firm.requestedBy|Basel|Oct 20');
    expect(requestedLine({ ...base, firmRequestedBy: { userId: 'u1', name: 'Nour' } }, 'u1', t, 'Oct 20')).toBe('hosted.profiles.firm.requestedByYou|Oct 20');
    expect(requestedLine(base, 'u1', t, 'Oct 20')).toBe('hosted.profiles.firm.requested|Oct 20');
  });

  it('falls back to the email of an owner with no name, and to the plain line for someone who left', () => {
    const owners = [{ userId: 'u2', name: null, email: 'basel@studio.ps', creator: true }];
    expect(requestedLine({ ...base, owners, firmRequestedBy: { userId: 'u2', name: null } }, 'u1', t, 'Oct 20')).toBe('hosted.profiles.firm.requestedBy|basel@studio.ps|Oct 20');
    expect(requestedLine({ ...base, owners: [], firmRequestedBy: { userId: 'gone', name: null } }, 'u1', t, 'Oct 20')).toBe('hosted.profiles.firm.requested|Oct 20');
  });
});
