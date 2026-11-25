import { afterEach, describe, expect, it } from 'vitest';
import { malafatReturnOf, malafatStartUrl, officeSlugOf, rememberedOffice, rememberOffice } from '../malafatSignIn';

describe('officeSlugOf', () => {
  it.each([
    ['sader', 'sader'],
    ['  Sader ', 'sader'],
    ['sader.malafat.app', 'sader'],
    ['https://sader.malafat.app/', 'sader'],
    ['http://sader.malafat.app/clients', 'sader'],
    ['al-ali-law', 'al-ali-law'],
  ])('%s → %s', (typed, slug) => {
    expect(officeSlugOf(typed)).toBe(slug);
  });

  it.each(['', '  ', '-sader', 'sader-', 'evil.example.com', 'sa der', 'صادر'])('refuses %j', (typed) => {
    expect(officeSlugOf(typed)).toBeNull();
  });
});

describe('the remembered office', () => {
  afterEach(() => window.localStorage.clear());

  it('is remembered on this device, empty at first', () => {
    expect(rememberedOffice()).toBe('');
    rememberOffice('sader');
    expect(rememberedOffice()).toBe('sader');
  });
});

describe('malafatStartUrl', () => {
  it('names the office and the web client', () => {
    expect(malafatStartUrl('sader')).toBe('/v1/auth/malafat/start?tenant=sader&client=web');
  });
});

describe('malafatReturnOf', () => {
  it('reads the result code, or a known error; anything else is an expired sign-in', () => {
    expect(malafatReturnOf('#result=abc')).toEqual({ result: 'abc' });
    expect(malafatReturnOf('#error=access_denied')).toEqual({ error: 'access_denied' });
    expect(malafatReturnOf('#error=whatever')).toEqual({ error: 'state_invalid' });
    expect(malafatReturnOf('')).toEqual({ error: 'state_invalid' });
  });
});
