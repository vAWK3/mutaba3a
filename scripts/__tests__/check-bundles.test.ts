// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { HOSTED_RULES, LOCAL_RULES, extractOrigins, findForbidden, newOrigins } from '../bundle-rules';

/** hosted-portal.md §8: the checks that keep the local builds and the portal apart. */

describe('local bundle rules', () => {
  it.each(['X-Mutaba3a-Profile', '/v1/me', 'mut_session', '__Host-mut_session', '/v1/sessions'])('flags the portal marker %s', (marker) => {
    expect(findForbidden(`fetch("${marker}")`, LOCAL_RULES).map((f) => f.rule)).not.toEqual([]);
  });

  it('passes ordinary app code', () => {
    expect(findForbidden('const db = new Dexie("mutaba3a"); indexedDB.open()', LOCAL_RULES)).toEqual([]);
  });

  // MUT-73: device sync is retired; its UI must not ship again.
  it.each(['backup.msync', 'invoke("start_sync_server")', 'Export Sync Bundle'])('flags the retired sync marker %s', (marker) => {
    expect(findForbidden(`x("${marker}")`, LOCAL_RULES).map((f) => f.rule)).not.toEqual([]);
  });

  it('does not mistake ordinary sync words for the retired feature', () => {
    expect(findForbidden('async function f(){} useSyncExternalStore(); "Syncing state"; flushSync()', LOCAL_RULES)).toEqual([]);
  });
});

describe('hosted bundle rules', () => {
  it.each(['indexedDB.open("x")', 'new Dexie("db")', 'navigator.serviceWorker.register("/sw.js")'])('flags local storage or offline machinery: %s', (code) => {
    expect(findForbidden(code, HOSTED_RULES)).not.toEqual([]);
  });

  it.each(['Sign up', 'sign-up', 'Create account', 'Forgot password?', 'Reset password', 'Invite a colleague', 'إنشاء حساب', 'نسيت كلمة المرور', 'إعادة تعيين', 'دعوة', 'اشترك الآن'])(
    'flags the self-service affordance "%s", case-insensitively',
    (copy) => {
      expect(findForbidden(`label:"${copy}"`, HOSTED_RULES)).not.toEqual([]);
    },
  );

  it('does not mistake "sign in" for "sign up"', () => {
    expect(findForbidden('"Sign in","تسجيل الدخول","Signing in…"', HOSTED_RULES)).toEqual([]);
  });

  it('reports the matched text and the rule', () => {
    expect(findForbidden('xx Forgot password xx', HOSTED_RULES)).toEqual([{ rule: 'forgot', match: 'Forgot' }]);
  });
});

describe('origins', () => {
  it('extracts scheme + host and ignores paths, ports kept', () => {
    const text = 'a="https://api.frankfurter.app/latest?x=1";b=`http://localhost:8787/v1`;c="https://github.com/vAWK3/x"';
    expect([...extractOrigins(text)].sort()).toEqual(['http://localhost:8787', 'https://api.frankfurter.app', 'https://github.com']);
  });

  it('reports only origins that are not on the allowlist', () => {
    expect(newOrigins(new Set(['https://github.com', 'https://evil.example']), ['https://github.com'])).toEqual(['https://evil.example']);
  });
});
