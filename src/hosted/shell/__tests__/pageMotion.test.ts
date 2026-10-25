import { describe, expect, it } from 'vitest';
import { depthOf, pageMotionOf, supportsViewTransitionTypes, viewTransitionOption } from '../pageMotion';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const p = (rest = '', id = A) => `/p/${id}${rest}`;

/** MUT-426 (eng D6): which way a page moves, from the two pathnames alone. The table is first-match-wins (S3). */
describe('depthOf', () => {
  it.each([
    [p(), 0],
    [p('/'), 0],
    [p('/payments'), 0],
    [p('/expenses'), 0],
    [p('/expenses/groups'), 0],
    [p('/clients'), 0],
    [p('/reports'), 0],
    [p('/receivables'), 1],
    [p('/conversions'), 1],
    [p('/documents'), 1],
    [p('/clients/c-1'), 1],
    [p('/expenses/groups/g-1'), 1],
  ])('%s is %i deep', (path, depth) => {
    expect(depthOf(path)).toBe(depth);
  });
});

describe('pageMotionOf', () => {
  it.each([
    ['first render', undefined, p(), 'none'],
    ['the same pathname (a filter, ?tx=, a drawer key)', p('/payments'), p('/payments'), 'none'],
    ['into You', p('/payments'), p('/you'), 'island'],
    ['into the profile-less You', '/', '/you', 'island'],
    ['You part to part', p('/you'), p('/you/account'), 'none'],
    ['profile-less You part to part', '/you', '/you/app', 'none'],
    ['leaving You', p('/you/account'), p('/payments'), 'back'],
    ['leaving You for another profile (first match wins)', p('/you'), p('/payments', B), 'back'],
    ['leaving the profile-less You for its page', '/you', '/', 'back'],
    ['signing out from You (sign-in never moves)', p('/you/account'), '/sign-in', 'none'],
    ['You → setup (setup never moves)', '/you', '/setup', 'none'],
    ['another profile', p('/payments'), p('/payments', B), 'fade'],
    ['Owed → Receivables', p(), p('/receivables'), 'forward'],
    ['Receivables → Owed', p('/receivables'), p(), 'back'],
    ['Clients → a client', p('/clients'), p('/clients/c-1'), 'forward'],
    ['a client → Documents (same depth)', p('/clients/c-1'), p('/documents'), 'fade'],
    ['tab to tab', p('/payments'), p('/clients'), 'fade'],
    ['Spent → its Groups tab', p('/expenses'), p('/expenses/groups'), 'fade'],
    ['a tab → Reports', p('/payments'), p('/reports'), 'fade'],
    ['Reports → a tab', p('/reports'), p(), 'fade'],
    ['outside the shell (sign-in → home)', '/sign-in', p(), 'none'],
    ['the home redirect', '/', p(), 'none'],
  ] as const)('%s is %s', (_name, prev, next, motion) => {
    expect(pageMotionOf(prev, next)).toBe(motion);
  });
});

describe('viewTransitionOption', () => {
  const info = (from: string | undefined, to: string) => ({
    fromLocation: from === undefined ? undefined : { pathname: from },
    toLocation: { pathname: to },
  });

  it('is unset where view-transition types are not supported, so drawers never cross-fade', () => {
    expect(viewTransitionOption(false)).toBeUndefined();
  });

  it('names the motion as the transition type', () => {
    const option = viewTransitionOption(true);
    if (!option) throw new Error('expected an option');
    expect(option.types(info(p(), p('/receivables')))).toEqual(['forward']);
    expect(option.types(info(p('/receivables'), p()))).toEqual(['back']);
    expect(option.types(info(p('/payments'), p('/you')))).toEqual(['island']);
    expect(option.types(info(p('/payments'), p('/clients')))).toEqual(['fade']);
  });

  it('starts no transition on a search-only change or the first render', () => {
    const option = viewTransitionOption(true);
    if (!option) throw new Error('expected an option');
    expect(option.types(info(p('/payments'), p('/payments')))).toBe(false);
    expect(option.types(info(undefined, p()))).toBe(false);
  });
});

describe('supportsViewTransitionTypes', () => {
  it('needs the selector to be supported, as the router checks it', () => {
    expect(supportsViewTransitionTypes(() => true)).toBe(true);
    expect(supportsViewTransitionTypes(() => false)).toBe(false);
    expect(supportsViewTransitionTypes(undefined)).toBe(false);
  });

  it('needs the router’s own spelling of the check to agree', () => {
    const seen: string[] = [];
    supportsViewTransitionTypes((query) => {
      seen.push(query);
      return true;
    });
    expect(seen).toContain('selector(:active-view-transition-type(a))');
    // router-core 1.144 router.js:146 drops the closing parenthesis; if that ever reads false, it would ignore our types
    expect(seen).toContain('selector(:active-view-transition-type(a)');
  });
});
