import { describe, it, expect } from 'vitest';
import { MALAFAT_CLIENT_THRESHOLD, pickClientsMoment } from '../malafatSuggestions';

describe('pickClientsMoment', () => {
  const on = { on: true, dismissed: [] };

  it('suggests at the client threshold, not one below it', () => {
    expect(MALAFAT_CLIENT_THRESHOLD).toBe(10);
    expect(pickClientsMoment({ suggestions: on, clientCount: 9, businessCount: 1 })).toBeNull();
    expect(pickClientsMoment({ suggestions: on, clientCount: 10, businessCount: 1 })).toBe('client-threshold');
  });

  it('suggests a second business once there are two, and prefers the client threshold when both hold', () => {
    expect(pickClientsMoment({ suggestions: on, clientCount: 2, businessCount: 2 })).toBe('second-business');
    expect(pickClientsMoment({ suggestions: on, clientCount: 12, businessCount: 3 })).toBe('client-threshold');
  });

  it('skips a dismissed moment, and says nothing when suggestions are off', () => {
    const dismissed = { on: true, dismissed: ['client-threshold' as const] };
    expect(pickClientsMoment({ suggestions: dismissed, clientCount: 12, businessCount: 2 })).toBe('second-business');
    expect(pickClientsMoment({ suggestions: { on: false, dismissed: [] }, clientCount: 12, businessCount: 2 })).toBeNull();
  });
});
