import { describe, expect, it } from 'vitest';
import { authEmailKey, authLog, AUTH_EVENT_KINDS, type AuthLogSink } from '../auth-log.js';

/** MUT-710 (ADR-275 D12): one structured line per authentication event, routed to the 12-month bucket by its `event`. */
describe('authentication log (MUT-710)', () => {
  function capture(): { sink: AuthLogSink; lines: Array<{ fields: Record<string, unknown>; message: string }> } {
    const lines: Array<{ fields: Record<string, unknown>; message: string }> = [];
    return { lines, sink: { info: (fields, message) => lines.push({ fields: fields as Record<string, unknown>, message }) } };
  }

  it('writes event=auth_event, which the Terraform sink filters on', () => {
    const { sink, lines } = capture();
    authLog(sink, { kind: 'sign_in.succeeded', userId: 'u-1', method: 'password', sessionKind: 'cookie', ip: '203.0.113.9', userAgent: 'Safari', requestId: 'r-1' });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.message).toBe('auth_event');
    expect(lines[0]!.fields).toEqual({
      event: 'auth_event',
      kind: 'sign_in.succeeded',
      userId: 'u-1',
      method: 'password',
      sessionKind: 'cookie',
      ip: '203.0.113.9',
      userAgent: 'Safari',
      requestId: 'r-1',
    });
  });

  it('keeps optional fields out rather than null, and truncates a long user agent', () => {
    const { sink, lines } = capture();
    authLog(sink, { kind: 'tax_authority.token_refreshed', userId: null, organizationId: 'o-1', userAgent: 'x'.repeat(500) });
    expect(lines[0]!.fields).toEqual({ event: 'auth_event', kind: 'tax_authority.token_refreshed', userId: null, organizationId: 'o-1', userAgent: 'x'.repeat(200) });
  });

  it('never carries a field the logger would redact or a credential could hide in', () => {
    const { sink, lines } = capture();
    // A caller can't pass extra fields through the typed entry; this guards the line's shape itself.
    authLog(sink, { kind: 'two_factor.failed', userId: 'u-1', method: 'totp', outcome: 'wrong' });
    const keys = Object.keys(lines[0]!.fields);
    for (const forbidden of ['code', 'token', 'password', 'secret', 'email']) expect(keys).not.toContain(forbidden);
  });

  it('names an unknown address only by a keyed digest', () => {
    const key = authEmailKey('pepper', 'Rana@Studio.ps ');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).toBe(authEmailKey('pepper', 'rana@studio.ps'));
    expect(key).not.toBe(authEmailKey('other-pepper', 'rana@studio.ps'));
    expect(key).not.toContain('rana');
  });

  it('covers sign-in, two-step, password and Tax Authority events', () => {
    for (const kind of ['sign_in.succeeded', 'sign_in.failed', 'sign_in.locked_out', 'two_factor.challenged', 'two_factor.verified', 'two_factor.failed', 'two_factor.enabled', 'two_factor.disabled', 'two_factor.recovery_code_used', 'two_factor.reset_by_operator', 'password.changed', 'password.reset', 'tax_authority.connected', 'tax_authority.connect_failed', 'tax_authority.disconnected', 'tax_authority.token_refreshed', 'tax_authority.token_refresh_failed']) {
      expect(AUTH_EVENT_KINDS).toContain(kind);
    }
  });
});
