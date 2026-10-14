import { describe, it, expect } from 'vitest';
import { createProfileSchema, editProfileSchema } from '../profileFormSchema';

const valid = { name: 'Nour Studio', type: 'BUSINESS', defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' };
const messages = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [String(issue.path[0]), issue.message]));

describe('createProfileSchema (FS1, FS2)', () => {
  it('accepts a complete profile and trims the name', () => {
    const result = createProfileSchema.safeParse({ ...valid, name: '  Nour Studio  ' });
    expect(result.success && result.data.name).toBe('Nour Studio');
  });

  it('rejects an empty or 81-character name with the name messages', () => {
    expect(messages(createProfileSchema.safeParse({ ...valid, name: '   ' }))).toEqual({ name: 'hosted.profiles.errors.nameRequired' });
    expect(messages(createProfileSchema.safeParse({ ...valid, name: 'x'.repeat(81) }))).toEqual({ name: 'hosted.profiles.errors.nameTooLong' });
    expect(createProfileSchema.safeParse({ ...valid, name: 'x'.repeat(80) }).success).toBe(true);
  });

  it('requires a type, with "Choose Personal or Business" (R5)', () => {
    expect(messages(createProfileSchema.safeParse({ ...valid, type: '' }))).toEqual({ type: 'hosted.profiles.errors.typeRequired' });
    expect(messages(createProfileSchema.safeParse({ ...valid, type: 'FIRM' }))).toEqual({ type: 'hosted.profiles.errors.typeRequired' });
  });

  it('accepts only the API currencies', () => {
    expect(createProfileSchema.safeParse({ ...valid, defaultCurrency: 'GBP' }).success).toBe(false);
    expect(createProfileSchema.safeParse({ ...valid, defaultCurrency: 'JOD' }).success).toBe(true);
  });
});

describe('editProfileSchema', () => {
  it('has the same name rules and no timezone', () => {
    expect(editProfileSchema.safeParse({ name: 'Studio', type: 'PERSONAL', defaultCurrency: 'ILS' }).success).toBe(true);
    expect(messages(editProfileSchema.safeParse({ name: '', type: 'PERSONAL', defaultCurrency: 'ILS' }))).toEqual({ name: 'hosted.profiles.errors.nameRequired' });
  });
});
