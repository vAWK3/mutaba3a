import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { assertLive, DEFAULT_LIVE_JURISDICTIONS, isLive, parseLiveJurisdictions } from '../jurisdictions.js';

/** MUT-740 (ADR-287 D1, D4): the countries whose invoicing rules are live on this server. */
describe('live jurisdictions (MUT-740)', () => {
  it('defaults to Israel only', () => {
    expect(DEFAULT_LIVE_JURISDICTIONS).toEqual(['IL']);
    expect(parseLiveJurisdictions(undefined)).toEqual(['IL']);
  });

  it('reads a comma list of ISO codes, upper-cased, trimmed and de-duplicated', () => {
    expect(parseLiveJurisdictions('IL')).toEqual(['IL']);
    expect(parseLiveJurisdictions(' il , sa,IL ')).toEqual(['IL', 'SA']);
  });

  it.each([[''], [' '], [','], ['ISR'], ['I'], ['IL;SA'], ['IL,,SA'], ['1L']])('refuses %j (null: the server must not boot on it)', (raw) => {
    expect(parseLiveJurisdictions(raw)).toBeNull();
  });

  it('isLive asks a country against the list', () => {
    expect(isLive(['IL'], 'IL')).toBe(true);
    expect(isLive(['IL'], 'JO')).toBe(false);
    expect(isLive(['IL'], 'il')).toBe(false);
  });

  it('assertLive passes a live country and refuses another with its reason, the country and the live list', () => {
    expect(() => assertLive(['IL'], 'IL')).not.toThrow();
    try {
      assertLive(['IL'], 'JO');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('VALIDATION_FAILED');
      expect((error as ApiError).details).toMatchObject({ reason: 'JURISDICTION_NOT_LIVE', country: 'JO', live: ['IL'], field: 'country' });
    }
  });
});
