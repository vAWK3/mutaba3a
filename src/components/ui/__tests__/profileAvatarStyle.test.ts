import { describe, it, expect } from 'vitest';
import { profileAvatarStyle } from '../profileAvatarStyle';

/**
 * MUT-102: a business avatar without its own colour must not set an inline
 * style, so its stylesheet's filled-button pair (--accent-solid / --on-accent,
 * 7:1 in light and dark) applies. A chosen colour keeps white initials.
 */
describe('profileAvatarStyle', () => {
  it('sets no inline style without a business colour', () => {
    expect(profileAvatarStyle(undefined)).toBeUndefined();
    expect(profileAvatarStyle('')).toBeUndefined();
  });

  it('ignores a colour the browser can’t read, so white initials never land on the default fill', () => {
    expect(profileAvatarStyle('3b82f6')).toBeUndefined();
    expect(profileAvatarStyle('#12')).toBeUndefined();
    expect(profileAvatarStyle('blue-ish')).toBeUndefined();
  });

  it('paints a chosen colour with white initials', () => {
    expect(profileAvatarStyle('#FF5500')).toEqual({ backgroundColor: '#FF5500', color: 'white' });
  });
});
