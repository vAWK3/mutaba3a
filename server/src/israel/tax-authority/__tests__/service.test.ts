import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../repositories/memory.js';
import { accessTokenFor, allocationInvoiceId, connectionFrom, needsAllocation, newState, readState, statusOf } from '../service.js';
import { TokenBox } from '../token-box.js';
import { FakeTaxAuthority } from './fake-client.js';
import type { ComposedDocument } from '../../../issuing/compose.js';

/** MUT-571/572 (ADR-264): the token box, the connect state, the locked refresh and the allocation rule. */
const box = new TokenBox('a-test-secret-with-at-least-32-characters');
const at = (iso: string) => new Date(iso);

describe('TokenBox', () => {
  it('seals so the stored text never holds the token, and opens it back; a changed byte opens to null', () => {
    const sealed = box.seal('access-1-secret-value');
    expect(sealed).not.toContain('access-1');
    expect(box.open(sealed)).toBe('access-1-secret-value');
    expect(box.seal('access-1-secret-value')).not.toBe(sealed);
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
    expect(box.open(tampered)).toBeNull();
    expect(new TokenBox('another-secret-with-at-least-32-characters').open(sealed)).toBeNull();
  });
});

describe('connect state', () => {
  it('names the profile and the person for ten minutes; a changed or late one is refused', () => {
    const now = at('2026-11-22T10:00:00Z');
    const state = newState('state-secret', 'p1', 'u1', now);
    expect(readState('state-secret', state, now)).toEqual({ profileId: 'p1', userId: 'u1' });
    expect(readState('state-secret', state, at('2026-11-22T10:11:00Z'))).toBeNull();
    expect(readState('other-secret', state, now)).toBeNull();
    const [body, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ profileId: 'p2', userId: 'u1', expiresAt: now.getTime() + 60_000 })).toString('base64url');
    expect(readState('state-secret', `${forged}.${mac}`, now)).toBeNull();
    expect(readState('state-secret', `${body}`, now)).toBeNull();
  });
});

describe('the connection', () => {
  async function connected(client: FakeTaxAuthority, now: Date) {
    const store = new MemoryLedgerStore();
    const tokens = await client.exchangeCode('good-code');
    await store.issuing.putTaxConnection(connectionFrom({ box, client }, tokens, { organizationId: 'p1', connectedByUserId: 'u1', connectedAt: now, refreshExpiresAt: null }, now));
    return { store, deps: { store, client, box, stateSecret: 's', accountingSoftwareNumber: 987654321 } };
  }

  it('is connected until 90 days after the consent, then expired', async () => {
    const client = new FakeTaxAuthority();
    const now = at('2026-11-22T10:00:00Z');
    const { store } = await connected(client, now);
    const record = await store.issuing.getTaxConnection('p1');
    expect(statusOf(record, 'sandbox', now)).toMatchObject({ state: 'connected', until: at('2027-01-30T08:00:00Z') });
    expect(statusOf(record, 'sandbox', at('2027-01-31T00:00:00Z')).state).toBe('expired');
    expect(statusOf(record, 'production', now).state).toBe('none');
    expect(statusOf(null, 'sandbox', now).state).toBe('none');
  });

  it('AC2: two callers needing a token at once refresh once; the single-use refresh token is sent once', async () => {
    const client = new FakeTaxAuthority();
    const start = at('2026-11-22T10:00:00Z');
    const { deps } = await connected(client, start);
    const later = at('2026-11-22T10:30:00Z');
    const [a, b] = await Promise.all([accessTokenFor(deps, 'p1', later), accessTokenFor(deps, 'p1', later)]);
    expect(client.refreshesSent).toEqual(['refresh-1-secret-value']);
    expect(a).toBe('access-2-secret-value');
    expect(b).toBe('access-2-secret-value');
  });

  it('answers the stored token while it is good, and none when not connected', async () => {
    const client = new FakeTaxAuthority();
    const now = at('2026-11-22T10:00:00Z');
    const { deps } = await connected(client, now);
    expect(await accessTokenFor(deps, 'p1', now)).toBe('access-1-secret-value');
    expect(client.refreshesSent).toEqual([]);
    expect(await accessTokenFor(deps, 'p2', now)).toBeNull();
  });
});

describe('needsAllocation (MUT-572)', () => {
  const doc = (netMinor: bigint, over: Partial<Parameters<typeof needsAllocation>[0]> = {}) => ({
    docType: 'TAX_INVOICE' as const,
    currency: 'ILS',
    documentDate: '2026-11-05',
    customerTaxId: '516123452',
    composed: { netMinor, vatMinor: netMinor / 5n } as ComposedDocument,
    ...over,
  });
  it('a tax invoice at or over ₪5,000 before VAT, to a customer with a VAT number', () => {
    expect(needsAllocation(doc(500_000n))).toBe(true);
    expect(needsAllocation(doc(499_999n))).toBe(false);
    expect(needsAllocation(doc(500_000n, { customerTaxId: null }))).toBe(false);
    expect(needsAllocation(doc(500_000n, { docType: 'RECEIPT' }))).toBe(false);
    expect(needsAllocation(doc(500_000n, { docType: 'TAX_INVOICE_RECEIPT' }))).toBe(true);
    expect(needsAllocation(doc(900_000n, { documentDate: '2026-05-31' }))).toBe(false);
  });
  it('one request id per issue request, the same on every retry', () => {
    expect(allocationInvoiceId('p1', 'key-1')).toBe(allocationInvoiceId('p1', 'key-1'));
    expect(allocationInvoiceId('p1', 'key-1')).not.toBe(allocationInvoiceId('p1', 'key-2'));
    expect(allocationInvoiceId('p1', 'key-1').length).toBeLessThanOrEqual(50);
  });
});
