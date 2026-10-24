import { describe, expect, it } from 'vitest';
import { CARRIED_EXPONENT } from '../../hosted/local/carryOver/money';
import { currencyExponent } from '../utils';

/** MUT-291: the carry-over keeps its own copy of the carried currencies' digits (the local chunk can't import ../utils); it must not drift. */
describe('CARRIED_EXPONENT', () => {
  it.each(Object.keys(CARRIED_EXPONENT))('%s has the app\'s own digits', (currency) => {
    expect(CARRIED_EXPONENT[currency as keyof typeof CARRIED_EXPONENT]).toBe(currencyExponent(currency as Parameters<typeof currencyExponent>[0]));
  });
});
