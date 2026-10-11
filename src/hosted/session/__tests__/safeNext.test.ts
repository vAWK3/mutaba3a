import { describe, it, expect } from 'vitest';
import { safeNext } from '../safeNext';

describe('safeNext', () => {
  it.each([
    ['/p/x/receivables?status=OPEN', '/p/x/receivables?status=OPEN'],
    ['/p/x', '/p/x'],
    ['/', '/'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    ['//evil.example'],
    ['https://evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['p/x'],
    [''],
    [undefined],
    ['/sign-in'],
    ['/sign-in?next=/p/x'],
    ['/p/x\n/evil'],
  ])('replaces %j with /', (input) => {
    expect(safeNext(input)).toBe('/');
  });
});
