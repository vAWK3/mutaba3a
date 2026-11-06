import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { SHARE_LINK_SESSION_READS, STORE_ACCESS, shareLinkStoreGuard, type MethodAccess } from '../store-guard.js';

/**
 * MUT-560 (ADR-246) test group 9, at the guard: every share-link view request runs under shareLinkStoreGuard, so a
 * repository write anywhere below a view handler throws 403 READ_ONLY_PROFILE (SHARE_LINK_READ_ONLY).
 */
const isRead = (access: MethodAccess) => access === 'read' || (typeof access === 'object' && 'read' in access);

describe('shareLinkStoreGuard (MUT-560)', () => {
  it('passes reads and the named feed reads; refuses every other classified method', () => {
    const guard = shareLinkStoreGuard();
    for (const [repo, methods] of Object.entries(STORE_ACCESS)) {
      for (const [method, access] of Object.entries(methods as Record<string, MethodAccess>)) {
        if (isRead(access) || SHARE_LINK_SESSION_READS.has(`${repo}.${method}`)) {
          expect(() => guard.assertCanCall(repo, method), `${repo}.${method}`).not.toThrow();
          continue;
        }
        let thrown: unknown;
        try {
          guard.assertCanCall(repo, method);
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `${repo}.${method}`).toBeInstanceOf(ApiError);
        expect((thrown as ApiError).code).toBe('READ_ONLY_PROFILE');
        expect((thrown as ApiError).details).toEqual({ reason: 'SHARE_LINK_READ_ONLY' });
      }
    }
  });

  it('the named reads are real, never-writing session reads', () => {
    for (const name of SHARE_LINK_SESSION_READS) {
      const [repo, method] = name.split('.') as [string, string];
      expect((STORE_ACCESS as Record<string, Record<string, MethodAccess>>)[repo]?.[method], name).toBe('sessionOnly');
    }
    expect([...SHARE_LINK_SESSION_READS].sort()).toEqual(['entries.list', 'entries.settledOwedIds']);
  });

  it('the link’s own lookups and stamps are refused under the guard (they run on the base store)', () => {
    for (const method of ['findViewerByDigest', 'touchViewer', 'touchOpened', 'addOrRotateViewer', 'create', 'revoke']) {
      expect(() => shareLinkStoreGuard().assertCanCall('shareLinks', method), method).toThrow(ApiError);
    }
  });
});
