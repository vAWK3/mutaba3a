import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { UniqueViolation } from '../memory.js';
import type { AuditEventInput, CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-434 storage contract (ADR-197): the OAuth server's rows. Every once-only step is a conditional claim (D6): two
 * decisions, two code exchanges or two refresh rotations racing each other change it once. Revokes audit only when
 * something changed; features.revoke and changePassword take the grants in their own transaction (AC7, D11); a grant
 * keeps its client from cleanup (OV5). Run against the memory store and Postgres.
 */
export function describeLedgerStoreOAuthContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 9, minute, 0));
  const userInput = (): CreateUserInput => ({
    email: `oauth-${unique()}@studio.ps`,
    displayName: 'Rana Saleh',
    passwordHash: 'hash',
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const audit = (organizationId: string, userId: string, action: string): AuditEventInput => ({ organizationId, actorType: 'USER', actorId: userId, action, entityType: 'user', entityId: userId, metadata: {}, requestId: 'req-mut434' });
  const agentAudit = async (store: LedgerStore, organizationId: string) =>
    (await store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('user.agent_')).map((e) => e.action);
  const digest = () => `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;

  async function grantFixture(store: LedgerStore) {
    const { user, personalOrganization: personal } = await store.users.create(userInput());
    const clientId = `mcl_${unique()}${unique()}`;
    await store.oauth.createClient({ id: clientId, clientName: 'Claude', redirectUris: ['https://claude.ai/cb'], at: at(1) });
    const request = await store.oauth.createAuthorizationRequest({ clientId, redirectUri: 'https://claude.ai/cb', codeChallenge: 'c'.repeat(43), scopes: ['read', 'write'], state: 's', resource: 'https://app.example/mcp', createdAt: at(1), expiresAt: at(31) });
    const codeDigest = digest();
    const decided = await store.oauth.decide({ requestId: request.id, userId: user.id, at: at(2), approve: { grantExpiresAt: at(59), code: { digest: codeDigest, expiresAt: at(3) } }, audit: [audit(personal.id, user.id, 'user.agent_connected')] });
    if (!decided.decided || !decided.grant) throw new Error('fixture decision failed');
    return { user, personal, clientId, request, grant: decided.grant, codeDigest };
  }

  const tokenPair = () => [
    { id: randomUUID(), digest: digest(), kind: 'ACCESS' as const, expiresAt: at(50) },
    { id: randomUUID(), digest: digest(), kind: 'REFRESH' as const, expiresAt: at(55) },
  ];

  describe(`${name} LedgerStore OAuth contract (MUT-434)`, () => {
    it('stores DCR and CIMD clients; a CIMD re-fetch updates the same row', async () => {
      const store = await makeStore();
      const id = `mcl_${unique()}`;
      expect(await store.oauth.createClient({ id, clientName: 'Claude', redirectUris: ['https://claude.ai/cb'], at: at(1) })).toMatchObject({ id, kind: 'DCR', metadataExpiresAt: null });
      await expect(store.oauth.createClient({ id, clientName: 'x', redirectUris: ['https://x.example/cb'], at: at(1) })).rejects.toBeInstanceOf(UniqueViolation);
      const url = `https://claude.ai/oauth/${unique()}.json`;
      await store.oauth.upsertCimdClient({ id: url, clientName: 'Claude', redirectUris: ['https://claude.ai/cb'], at: at(1), metadataExpiresAt: at(2) });
      await store.oauth.upsertCimdClient({ id: url, clientName: 'Claude 2', redirectUris: ['https://claude.com/cb'], at: at(3), metadataExpiresAt: at(4) });
      expect(await store.oauth.findClient(url)).toMatchObject({ kind: 'CIMD', clientName: 'Claude 2', redirectUris: ['https://claude.com/cb'], createdAt: at(1), metadataExpiresAt: at(4) });
    });

    it('decides a request once, audited with the grant; not after it expires', async () => {
      const store = await makeStore();
      const { user, personal, clientId, request } = await grantFixture(store);
      expect(await store.oauth.decide({ requestId: request.id, userId: user.id, at: at(4), approve: null, audit: [] })).toEqual({ decided: false });
      expect(await agentAudit(store, personal.id)).toEqual(['user.agent_connected']);
      const late = await store.oauth.createAuthorizationRequest({ clientId, redirectUri: 'https://claude.ai/cb', codeChallenge: 'c'.repeat(43), scopes: ['read'], state: null, resource: 'https://app.example/mcp', createdAt: at(1), expiresAt: at(5) });
      expect(await store.oauth.decide({ requestId: late.id, userId: user.id, at: at(5), approve: null, audit: [] })).toEqual({ decided: false });
    });

    it('two racing decisions change it once', async () => {
      const store = await makeStore();
      const { user, clientId } = await grantFixture(store);
      const request = await store.oauth.createAuthorizationRequest({ clientId, redirectUri: 'https://claude.ai/cb', codeChallenge: 'c'.repeat(43), scopes: ['read'], state: null, resource: 'https://app.example/mcp', createdAt: at(1), expiresAt: at(30) });
      const decide = () => store.oauth.decide({ requestId: request.id, userId: user.id, at: at(2), approve: { grantExpiresAt: at(59), code: { digest: digest(), expiresAt: at(3) } }, audit: [] });
      const results = await Promise.all([decide(), decide()]);
      expect(results.filter((r) => r.decided)).toHaveLength(1);
    });

    it('exchanges a code once; a second exchange reports reuse; an expired one is invalid', async () => {
      const store = await makeStore();
      const { codeDigest, grant } = await grantFixture(store);
      const results = await Promise.all([store.oauth.exchangeCode({ digest: codeDigest, at: at(2), tokens: tokenPair() }), store.oauth.exchangeCode({ digest: codeDigest, at: at(2), tokens: tokenPair() })]);
      expect(results.map((r) => r.status).sort()).toEqual(['exchanged', 'reused']);
      expect(await store.oauth.exchangeCode({ digest: digest(), at: at(2), tokens: [] })).toEqual({ status: 'invalid' });
      const exchanged = results.find((r) => r.status === 'exchanged');
      expect(exchanged?.status === 'exchanged' && exchanged.grant.id).toBe(grant.id);
    });

    it('finds tokens by digest with their grant, and rotates a refresh token once', async () => {
      const store = await makeStore();
      const { codeDigest, grant } = await grantFixture(store);
      const pair = tokenPair();
      await store.oauth.exchangeCode({ digest: codeDigest, at: at(2), tokens: pair });
      const refresh = pair[1]!;
      const found = await store.oauth.findToken(refresh.digest);
      expect(found).toMatchObject({ token: { id: refresh.id, kind: 'REFRESH', rotatedAt: null }, grant: { id: grant.id } });
      const successorId = randomUUID();
      const next = [{ id: randomUUID(), digest: digest(), kind: 'ACCESS' as const, expiresAt: at(50) }, { id: successorId, digest: digest(), kind: 'REFRESH' as const, expiresAt: at(55) }];
      const other = [{ id: randomUUID(), digest: digest(), kind: 'ACCESS' as const, expiresAt: at(50) }, { id: randomUUID(), digest: digest(), kind: 'REFRESH' as const, expiresAt: at(55) }];
      const rotated = await Promise.all([store.oauth.rotateRefresh({ tokenId: refresh.id, successorId, at: at(10), tokens: next }), store.oauth.rotateRefresh({ tokenId: refresh.id, successorId: other[1]!.id, at: at(10), tokens: other })]);
      expect(rotated.filter(Boolean)).toHaveLength(1);
      const after = await store.oauth.findTokenById(refresh.id);
      expect(after?.rotatedAt).toEqual(at(10));
      expect(await store.oauth.findTokenById(after!.successorId!)).toMatchObject({ kind: 'REFRESH' });
    });

    it('revokes one grant once (owner-scoped), and all of a person’s grants, auditing only on change', async () => {
      const store = await makeStore();
      const { user, personal, grant } = await grantFixture(store);
      expect(await store.oauth.revokeGrant({ grantId: grant.id, userId: randomUUID(), reason: 'user', at: at(5), audit: [] })).toBe(false);
      expect(await store.oauth.revokeGrant({ grantId: grant.id, userId: user.id, reason: 'user', at: at(5), audit: [audit(personal.id, user.id, 'user.agent_disconnected')] })).toBe(true);
      expect(await store.oauth.revokeGrant({ grantId: grant.id, reason: 'user', at: at(6), audit: [audit(personal.id, user.id, 'user.agent_disconnected')] })).toBe(false);
      expect(await store.oauth.findGrant(grant.id)).toMatchObject({ revokedAt: at(5), revokedReason: 'user' });
      expect(await store.oauth.revokeAllForUser({ userId: user.id, reason: 'operator', at: at(7), audit: [audit(personal.id, user.id, 'user.agent_disconnected')] })).toBe(0);
      expect((await agentAudit(store, personal.id)).sort()).toEqual(['user.agent_connected', 'user.agent_disconnected']);
    });

    it('lists live grants with the client name, newest first', async () => {
      const store = await makeStore();
      const { user, grant } = await grantFixture(store);
      expect(await store.oauth.listLiveGrants(user.id, at(10))).toMatchObject([{ id: grant.id, clientName: 'Claude', clientKind: 'DCR', scopes: ['read', 'write'] }]);
      expect(await store.oauth.listLiveGrants(user.id, at(59))).toEqual([]);
    });

    it('features.revoke with agentGrants takes the grants in the same step (AC7)', async () => {
      const store = await makeStore();
      const { user, personal } = await grantFixture(store);
      await store.features.grant({ userId: user.id, feature: 'agent_access', grantedBy: 'admin', at: at(1), audit: [] });
      const result = await store.features.revoke({ userId: user.id, feature: 'agent_access', at: at(8), audit: [], agentGrants: { audit: [audit(personal.id, user.id, 'user.agent_disconnected')] } });
      expect(result).toEqual({ revoked: true, agentGrantsRevoked: 1 });
      expect(await store.oauth.listLiveGrants(user.id, at(9))).toEqual([]);
    });

    const TERMS = { version: '2026-10-19', locale: 'en' as const, textSha256: 'f'.repeat(64), surface: 'portal' as const, clientRelease: null };

    it('a locking setup link takes the grants in the same step, audited (review finding 1)', async () => {
      const store = await makeStore();
      const { user, personal } = await grantFixture(store);
      await store.accountSetup.issue({ userId: user.id, tokenDigest: digest(), purpose: 'RESET', at: at(4), expiresAt: at(50), lock: true, audit: [] });
      expect(await store.oauth.listLiveGrants(user.id, at(5))).toEqual([]);
      expect((await agentAudit(store, personal.id)).sort()).toEqual(['user.agent_connected', 'user.agent_disconnected']);
    });

    it('redeeming a setup or recovery link takes the grants, audited; a person with none writes no row', async () => {
      const store = await makeStore();
      const { user, personal } = await grantFixture(store);
      const link = await store.accountSetup.issue({ userId: user.id, tokenDigest: digest(), purpose: 'RESET', at: at(4), expiresAt: at(50), lock: false, audit: [] });
      expect(await store.oauth.listLiveGrants(user.id, at(5))).toHaveLength(1);
      await store.accountSetup.redeem({ tokenDigest: link.tokenDigest, passwordHash: 'new-hash', at: at(5), audit: [], terms: TERMS, termsAudit: [] });
      expect(await store.oauth.listLiveGrants(user.id, at(6))).toEqual([]);
      expect((await agentAudit(store, personal.id)).sort()).toEqual(['user.agent_connected', 'user.agent_disconnected']);

      const again = await store.accountSetup.issue({ userId: user.id, tokenDigest: digest(), purpose: 'RESET', at: at(6), expiresAt: at(50), lock: false, audit: [] });
      await store.accountSetup.redeem({ tokenDigest: again.tokenDigest, passwordHash: 'newer-hash', at: at(7), audit: [], terms: TERMS, termsAudit: [] });
      expect((await agentAudit(store, personal.id)).sort()).toEqual(['user.agent_connected', 'user.agent_disconnected']);
    });

    it('cleanup keeps an old client whose authorization request is still recent (review finding 6)', async () => {
      const store = await makeStore();
      const clientId = `mcl_${unique()}${unique()}`;
      await store.oauth.createClient({ id: clientId, clientName: 'Claude', redirectUris: ['https://claude.ai/cb'], at: at(0) });
      await store.oauth.createAuthorizationRequest({ clientId, redirectUri: 'https://claude.ai/cb', codeChallenge: 'c'.repeat(43), scopes: ['read'], state: 's', resource: 'https://app.example/mcp', createdAt: at(15), expiresAt: at(45) });
      await store.oauth.cleanup({ at: at(20), before: at(10), clientsBefore: at(10) });
      expect(await store.oauth.findClient(clientId)).not.toBeNull();
    });

    it('cleanup removes expired rows and never-granted clients, but keeps a client with a grant (OV5)', async () => {
      const store = await makeStore();
      const { clientId, grant } = await grantFixture(store);
      const orphan = `mcl_${unique()}`;
      await store.oauth.createClient({ id: orphan, clientName: 'x', redirectUris: ['https://x.example/cb'], at: at(0) });
      await store.oauth.revokeGrant({ grantId: grant.id, reason: 'user', at: at(4), audit: [] });
      const result = await store.oauth.cleanup({ at: at(40), before: at(30), clientsBefore: at(10) });
      expect(result.clients).toBeGreaterThanOrEqual(1);
      expect(await store.oauth.findClient(orphan)).toBeNull();
      expect(await store.oauth.findClient(clientId)).not.toBeNull();
    });
  });
}
