import { describe, expect, it } from 'vitest';
import { ADMIN, DAY, accountantHarness, idem, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-764 (accountant channel, epic MUT-762; eng T3, CEO ACCT-2 and ACCT-7, R2 and R3): an operator-approved accountant
 * creates a customer's passwordless account, business profile and read grant in one call, behind the
 * ACCOUNTANT_PROVISIONING dark flag. The response carries the 6-digit claim code once and NEVER the setup link or its
 * token (ADR-088); a replay of the same key returns the state and never the code; two daily limits stop a misuse.
 */
const PATH = '/v1/accountant/customers';

const body = (over: Record<string, unknown> = {}) => ({
  email: `owner${Math.random().toString(36).slice(2, 8)}@cafe-nour.ps`,
  displayName: 'Samer Haddad',
  profileName: 'Café Nour',
  defaultCurrency: 'ILS',
  timezone: 'Asia/Jerusalem',
  locale: 'ar',
  ...over,
});

function harness(overrides: Parameters<typeof accountantHarness>[0] = {}) {
  return accountantHarness({ accountantProvisioning: true, ...overrides });
}

/** A signed-in person the operator approved to provision (limits default unless given). */
async function approved(h: AccountantHarness, limits: { create?: number | null; lookup?: number | null } = {}): Promise<Person> {
  const accountant = await person(h, { sharing: false });
  await h.store.provision.setApproval({ userId: accountant.userId, enabled: true, createLimitPerDay: limits.create ?? null, lookupLimitPerDay: limits.lookup ?? null, at: h.now() });
  return accountant;
}

const create = (h: AccountantHarness, who: Person, payload: object, key: Record<string, string> = idem()) => h.app.request(PATH, json(payload, { ...who.auth, ...key }));

describe('POST /v1/accountant/customers (MUT-764)', () => {
  it('answers 404 when ACCOUNTANT_PROVISIONING is off, for anyone', async () => {
    const h = accountantHarness({ accountantProvisioning: false });
    const accountant = await approved(h);
    const res = await create(h, accountant, body());
    expect(res.status).toBe(404);
    expect((await read(res)).error.code).toBe('NOT_FOUND');
  });

  it('answers 403 ACCOUNTANT_NOT_APPROVED for a person the operator has not approved', async () => {
    const h = harness();
    const stranger = await person(h, { sharing: false });
    const res = await create(h, stranger, body());
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('ACCOUNTANT_NOT_APPROVED');
    expect(await h.store.provision.listUnclaimed({ limit: 10 })).toEqual([]);
  });

  it('refuses a withdrawn approval, and a request with no session', async () => {
    const h = harness();
    const accountant = await approved(h);
    await h.store.provision.setApproval({ userId: accountant.userId, enabled: false, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
    expect((await create(h, accountant, body())).status).toBe(403);
    expect((await h.app.request(PATH, json(body(), idem()))).status).toBe(401);
  });

  it('needs an Idempotency-Key', async () => {
    const h = harness();
    const accountant = await approved(h);
    const res = await h.app.request(PATH, json(body(), accountant.auth));
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('creates the account, the profile and the read grant, returns the claim code once and mails the link to the customer', async () => {
    const h = harness();
    const accountant = await approved(h);
    const payload = body({ email: 'Samer@Cafe-Nour.ps' });
    const res = await create(h, accountant, payload);
    expect(res.status).toBe(201);
    const out = await read(res);

    expect(out).toMatchObject({ status: 'created', customer: { email: 'samer@cafe-nour.ps', displayName: 'Samer Haddad' }, profile: { name: 'Café Nour' }, mailSent: true });
    expect(out.claimCode).toMatch(/^\d{6}$/);
    expect(typeof out.linkExpiresAt).toBe('string');

    // The accountant reads the profile through an ACTIVE grant and owns nothing.
    expect((await h.store.accountantGrants.findActive(accountant.userId, out.profile.id))?.status).toBe('ACTIVE');
    // The customer has an account without a password, created by this accountant.
    expect(await h.store.provision.originOf(out.customer.userId)).toMatchObject({ accountantUserId: accountant.userId });
    expect((await h.store.users.getById(out.customer.userId))?.passwordHash).toBeNull();

    // The link goes to the customer's inbox, in their language, and nowhere else.
    const [mail] = h.transport.list({ to: 'samer@cafe-nour.ps' });
    expect(mail).toMatchObject({ template: 'customer-setup', locale: 'ar' });
    expect(mail!.text).toMatch(/http:\/\/localhost\/setup#[A-Za-z0-9_-]{43}/);
    expect(mail!.text).not.toContain(out.claimCode);
    // Nothing about the customer reaches the accountant's inbox.
    expect(h.transport.list({ to: accountant.email }).filter((m) => m.template === 'customer-setup')).toEqual([]);
  });

  it('never puts the setup link or its token in the response, and the code only in the first one', async () => {
    const h = harness();
    const accountant = await approved(h);
    const res = await create(h, accountant, body());
    const text = await res.clone().text();
    const [mail] = h.transport.list({ to: (await read(res)).customer.email });
    const token = /setup#([A-Za-z0-9_-]{43})/.exec(mail!.text)![1]!;
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/setup#|token|tokenDigest|claimCodeDigest/i);
  });

  it('replays a repeated key with the state and never the code, creating and mailing once', async () => {
    const h = harness();
    const accountant = await approved(h);
    const key = idem();
    const payload = body();
    const first = await read(await create(h, accountant, payload, key));
    expect(first.claimCode).toMatch(/^\d{6}$/);

    const replay = await create(h, accountant, payload, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    const again = await read(replay);
    expect(again.claimCode).toBeUndefined();
    expect(again.customer).toEqual(first.customer);
    expect(again.profile).toEqual(first.profile);

    expect(await h.store.provision.countCreatedSince(accountant.userId, new Date(0))).toBe(1);
    expect(h.transport.list({ to: payload.email })).toHaveLength(1);
  });

  it('refuses a key reused with a different body (422)', async () => {
    const h = harness();
    const accountant = await approved(h);
    const key = idem();
    await create(h, accountant, body(), key);
    const res = await create(h, accountant, body(), key);
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('stops at the daily creation limit, per UTC day, and the operator can change it per accountant', async () => {
    const h = harness();
    const accountant = await approved(h, { create: 2 });
    expect((await create(h, accountant, body())).status).toBe(201);
    expect((await create(h, accountant, body())).status).toBe(201);
    const third = await create(h, accountant, body());
    expect(third.status).toBe(429);
    expect((await read(third)).error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: 'CREATE_PER_DAY', max: 2 } });
    expect(await h.store.provision.countCreatedSince(accountant.userId, new Date(0))).toBe(2);

    // Raised for this accountant, it goes on; another accountant's default is untouched.
    await h.store.provision.setApproval({ userId: accountant.userId, enabled: true, createLimitPerDay: 3, lookupLimitPerDay: null, at: h.now() });
    expect((await create(h, accountant, body())).status).toBe(201);

    // The next UTC day starts a new count.
    h.setNow(new Date(h.now().getTime() + DAY));
    expect((await create(h, accountant, body())).status).toBe(201);
  });

  it('uses 50 creations and 100 existing-address attempts a day when the operator set nothing', async () => {
    const h = harness();
    const accountant = await approved(h);
    // Fifty accounts already created today by this accountant: the 51st is refused.
    for (let i = 0; i < 50; i += 1) {
      await h.store.provision.create({
        accountantUserId: accountant.userId,
        email: `bulk${i}@cafe-nour.ps`,
        displayName: 'Bulk',
        locale: 'en',
        personal: { name: 'Personal', slug: `personal-bulk-${i}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        profile: { name: 'Bulk', slug: `bulk-${i}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        setupLink: { tokenDigest: `bulk-digest-${i}`, expiresAt: new Date(h.now().getTime() + 14 * DAY) },
        claimCodeDigest: `bulk-claim-${i}`,
        at: h.now(),
        auditFor: () => [],
      });
    }
    const res = await create(h, accountant, body());
    expect(res.status).toBe(429);
    expect((await read(res)).error.details).toMatchObject({ limit: 'CREATE_PER_DAY', max: 50 });
  });

  it('tells the accountant an existing address has an account, creates nothing, audits it and counts it', async () => {
    const h = harness();
    const accountant = await approved(h);
    const taken = await person(h, { sharing: false });
    const mailsBefore = h.transport.list({ to: taken.email }).length;
    const res = await create(h, accountant, body({ email: taken.email }));
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ status: 'exists' });

    expect(await h.store.provision.countCreatedSince(accountant.userId, new Date(0))).toBe(0);
    // The existing account is not mailed anything.
    expect(h.transport.list({ to: taken.email })).toHaveLength(mailsBefore);
    expect(await h.store.provision.countLookupsSince(accountant.userId, new Date(0))).toBe(1);
    const events = await h.store.audit.listByOrganization(accountant.personalId, 20);
    expect(events.map((e) => e.action)).toContain('accountant.customer_lookup_existing');
    // The address never lands in the audit trail.
    expect(JSON.stringify(events)).not.toContain(taken.email);
  });

  it('stops at the daily existing-address limit with the same 429, without a further count', async () => {
    const h = harness();
    const accountant = await approved(h, { lookup: 2 });
    const taken = await person(h, { sharing: false });
    expect((await create(h, accountant, body({ email: taken.email }))).status).toBe(200);
    expect((await create(h, accountant, body({ email: taken.email }))).status).toBe(200);
    const third = await create(h, accountant, body({ email: taken.email }));
    expect(third.status).toBe(429);
    expect((await read(third)).error.details).toMatchObject({ limit: 'LOOKUP_PER_DAY', max: 2 });
    expect(await h.store.provision.countLookupsSince(accountant.userId, new Date(0))).toBe(2);
  });

  it('treats the accountant’s own address and a just-created customer’s address as existing', async () => {
    const h = harness();
    const accountant = await approved(h);
    expect((await read(await create(h, accountant, body({ email: accountant.email })))).status).toBe('exists');
    const made = body();
    expect((await create(h, accountant, made)).status).toBe(201);
    expect((await read(await create(h, accountant, made))).status).toBe('exists');
  });

  it('refuses a throwaway address, and a malformed request, without counting either', async () => {
    const h = harness();
    const accountant = await approved(h);
    const disposable = await create(h, accountant, body({ email: 'x@mailinator.com' }));
    expect(disposable.status).toBe(422);
    expect((await read(disposable)).error.details).toMatchObject({ reason: 'ADDRESS_REFUSED' });
    expect((await create(h, accountant, { email: 'nope' })).status).toBe(422);
    expect((await create(h, accountant, body({ timezone: 'Mars/Base' }))).status).toBe(422);
    expect(await h.store.provision.countCreatedSince(accountant.userId, new Date(0))).toBe(0);
    expect(await h.store.provision.countLookupsSince(accountant.userId, new Date(0))).toBe(0);
  });

  it('leaves a customer unable to sign in until they claim the account', async () => {
    const h = harness();
    const accountant = await approved(h);
    const payload = body();
    await create(h, accountant, payload);
    const res = await h.app.request('/v1/device-sessions', json({ email: payload.email, password: 'whatever-password-1' }));
    expect(res.status).toBe(401);
  });

  it('keeps the accountant read-only on the new profile: the grant is ACTIVE read, not a membership', async () => {
    const h = harness();
    const accountant = await approved(h);
    const out = await read(await create(h, accountant, body()));
    expect(await h.store.memberships.find(accountant.userId, out.profile.id)).toBeNull();
    // The ordinary write routes refuse the accountant on that profile.
    const write = await h.app.request('/v1/customers', json({ name: 'Walk-in' }, { ...accountant.on(out.profile.id), ...idem() }));
    expect([403, 404]).toContain(write.status);
  });
});

describe('the dark flag never exposes the route in the spec’s absence', () => {
  it('registers the route in OpenAPI even while it answers 404', async () => {
    const h = accountantHarness({ accountantProvisioning: false });
    const spec = await read(await h.app.request('/openapi.json', { headers: ADMIN }));
    expect(Object.keys(spec.paths)).toContain(PATH);
  });
});
