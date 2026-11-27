import { describe, expect, it } from 'vitest';
import { PACK_FIXTURES } from '../jurisdictions/__tests__/fixtures/index.js';
import { packFor, registeredCountries } from '../jurisdictions/index.js';
import { ADMIN, businessOf, idem, issuingHarness, json, person, read, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-745 (ADR-287, jurisdiction-packs.md step 6): what the issuing core promises under every registered pack, through
 * the real routes, with each pack's fixture: the stamp (jurisdiction and pack version), gap-free numbering, an
 * idempotent retry, lines that add up to the document, no change after issue, and a refused clearance that leaves no
 * trace. The pack's own rules are `jurisdictions/__tests__/pack.contract.test.ts`.
 */
const COUNTRIES = registeredCountries().filter((c) => PACK_FIXTURES[c]);
/** Minor units of a decimal amount string; every amount of one document has the same scale. */
const minor = (amount: string): bigint => BigInt(amount.replace('.', ''));

async function invoicing(h: AccountantHarness, country: string, customer: Record<string, unknown> = { name: 'Acme Digital Ltd.' }) {
  const fixture = PACK_FIXTURES[country]!;
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Contract Studio');
  const on = owner.on(profileId);
  const issuer = await h.app.request('/v1/issuer', json(fixture.route.issuer, on, 'PUT'));
  expect(issuer.status, await issuer.clone().text()).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const created = await read(await h.app.request('/v1/customers', json(customer, { ...on, ...idem() })));
  return { profileId, on, customerId: created.id as string, document: () => fixture.route.document(created.id as string) };
}

const issue = (h: AccountantHarness, on: Record<string, string>, body: unknown, key = idem()) => h.app.request('/v1/issued-documents', json(body, { ...on, ...key }));
const issued = async (h: AccountantHarness, on: Record<string, string>, body: unknown) => {
  const res = await issue(h, on, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return read(res);
};
const listed = async (h: AccountantHarness, on: Record<string, string>) => (await read(await h.app.request('/v1/issued-documents', { headers: on }))).items as unknown[];

describe.each(COUNTRIES)('the issuing contract under the %s pack', (country) => {
  const pack = packFor(country);
  const harness = () => issuingHarness({ invoicingJurisdictions: [...new Set(['IL', ...registeredCountries()])] });

  it('stamps the jurisdiction and pack version on the document, its issuer snapshot and its audit entry', async () => {
    const h = harness();
    const w = await invoicing(h, country);
    const doc = await issued(h, w.on, w.document());
    expect(doc).toMatchObject({ jurisdiction: pack.country, jurisdictionPackVersion: pack.version, issuer: { country: pack.country, vatIdScheme: pack.taxId.scheme } });
    const audit = await h.store.audit.listByOrganization(w.profileId, 50);
    expect(audit.find((e) => e.action === 'issued_document.issued')?.metadata).toMatchObject({ jurisdiction: pack.country, packVersion: pack.version });
  });

  it('numbers without gaps: 1, 2, 3, and the gap report finds none', async () => {
    const h = harness();
    const w = await invoicing(h, country);
    const numbers = [];
    for (let i = 0; i < 3; i += 1) numbers.push((await issued(h, w.on, w.document())).number);
    expect(numbers).toEqual([1, 2, 3]);
    const gaps = await read(await h.app.request('/v1/issuing/gaps', { headers: w.on }));
    for (const t of gaps.types as { missing: number[] }[]) expect(t.missing).toEqual([]);
  });

  it('a retry with the same Idempotency-Key returns the same document and takes no number', async () => {
    const h = harness();
    const w = await invoicing(h, country);
    const key = idem();
    const first = await issue(h, w.on, w.document(), key);
    expect(first.status).toBe(201);
    const again = await issue(h, w.on, w.document(), key);
    expect(again.status).toBe(201);
    expect((await read(again)).id).toBe((await read(first)).id);
    expect(await listed(h, w.on)).toHaveLength(1);
    expect((await issued(h, w.on, w.document())).number).toBe(2);
  });

  it('the lines add up to the document: Σ nets = subtotal, subtotal − discount = net, Σ VAT = VAT, net + VAT = gross', async () => {
    const h = harness();
    const w = await invoicing(h, country);
    const doc = await issued(h, w.on, w.document());
    const lines = doc.lines as { net: string; vat: string }[];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.reduce((s, l) => s + minor(l.net), 0n)).toBe(minor(doc.subtotal));
    expect(minor(doc.subtotal) - minor(doc.discount)).toBe(minor(doc.net));
    expect(lines.reduce((s, l) => s + minor(l.vat), 0n)).toBe(minor(doc.vat));
    expect(minor(doc.net) + minor(doc.vat)).toBe(minor(doc.gross));
    expect(doc.vatRateBasisPoints).toBe(pack.vat.rateOn(doc.documentDate));
  });

  it('nothing changes an issued document: no PATCH, PUT or DELETE, and it reads back the same', async () => {
    const h = harness();
    const w = await invoicing(h, country);
    const doc = await issued(h, w.on, w.document());
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const res = await h.app.request(`/v1/issued-documents/${doc.id}`, { method, headers: { ...w.on, 'content-type': 'application/json' }, body: method === 'DELETE' ? null : '{}' });
      expect([404, 405]).toContain(res.status);
    }
    expect(await read(await h.app.request(`/v1/issued-documents/${doc.id}`, { headers: w.on }))).toEqual(doc);
  });

  const failure = PACK_FIXTURES[country]!.route.clearanceFailure;
  it.runIf(pack.clearance !== undefined)('a refused clearance leaves no trace: no document, no audit entry, no number taken', async () => {
    expect(failure, 'a pack with clearance needs a clearanceFailure in its fixture').toBeDefined();
    const h = failure!.harness();
    const w = await invoicing(h, country, failure!.customer);
    await failure!.prepare(h, w.on);
    const refused = await issue(h, w.on, failure!.document(w.customerId));
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await read(refused)).error.details).toMatchObject({ reason: failure!.reason });
    expect(await listed(h, w.on)).toEqual([]);
    const audit = await h.store.audit.listByOrganization(w.profileId, 50);
    expect(audit.filter((e) => e.action === 'issued_document.issued')).toEqual([]);
    expect((await issued(h, w.on, w.document())).number).toBe(1);
  });
});
