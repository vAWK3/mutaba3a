import { describe, expect, it, vi } from 'vitest';
import { AGENT_STORE_METHODS } from '../auth/store-guard.js';
import { ADMIN, CLAUDE_CB, MCP_HEADERS, RESOURCE, VERIFIER, authorize, connect, form, harness, json, person, read, register, requestIdFrom, rpc, tool, toolError, type Harness, type Loose, type Person } from './helpers/oauth-agent.js';

/**
 * MUT-435: the MCP read tools, driven through the real /mcp with an OAuth token, so the agent store guard and the
 * profile rule (owned + co-owned only, P1) both apply exactly as they do for Claude.
 */
const READ_TOOLS = ['find_similar_expenses', 'list_categories', 'list_clients', 'list_inbox', 'list_profiles', 'list_vendors'];
const SHOW_FIRST = 'Show the person what you found';
let keySeq = 0;
const asPerson = (p: Person, profileId?: string) => ({ ...p.cookie, ...(profileId ? { 'x-mutaba3a-profile': profileId } : {}), 'idempotency-key': `mut435-test-key-${++keySeq}` });

async function business(h: Harness, p: Person, name = 'Studio'): Promise<string> {
  const res = await h.app.request('/v1/profiles', json({ name, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, asPerson(p)));
  expect(res.status).toBe(201);
  return (await read(res)).id as string;
}

async function expense(h: Harness, p: Person, profileId: string, body: Record<string, unknown>): Promise<string> {
  const res = await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-20', currency: 'ILS', ...body }, asPerson(p, profileId)));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await read(res)).id as string;
}

async function inbox(h: Harness, p: Person, body: Record<string, unknown>): Promise<string> {
  const res = await h.app.request('/v1/inbox', json({ kind: 'expense', currency: 'ILS', occurredOn: '2026-10-21', ...body }, asPerson(p)));
  expect(res.status).toBe(201);
  return (await read(res)).id as string;
}

/** A firm-style profile the person only belongs to (no ownership): invisible to their agent (P1). */
async function memberOnlyProfile(h: Harness, p: Person): Promise<string> {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Law Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
  const orgId = (org.organization?.id ?? org.id) as string;
  expect((await h.app.request(`/admin/v1/users/${p.userId}/memberships`, json({ organizationId: orgId }, ADMIN))).status).toBe(201);
  return orgId;
}

async function setup() {
  const h = harness();
  const p = await person(h);
  const agent = await connect(h, p);
  return { h, p, bearer: agent.bearer };
}

describe('tools/list (AC3)', () => {
  it('offers the six read tools (beside MUT-436’s write tools), each telling the agent to show the person what it found, with an output schema', async () => {
    const { h, bearer } = await setup();
    const { result } = await rpc(h, bearer, 'tools/list');
    const all = result.tools as Array<{ name: string; description: string; outputSchema?: unknown }>;
    const tools = all.filter((t) => READ_TOOLS.includes(t.name));
    expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
    for (const t of tools) {
      expect(t.description, t.name).toContain(SHOW_FIRST);
      expect(t.outputSchema, t.name).toBeDefined();
    }
  });

  it('offers no read tool to a grant without the read scope', async () => {
    const h = harness();
    const p = await person(h);
    const clientId = await register(h);
    const requestId = await requestIdFrom(await authorize(h, clientId, { scope: 'write' }));
    const decided = await read(await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie)));
    const code = new URL(decided.redirectTo).searchParams.get('code') ?? '';
    const tokens = await read(await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE })));
    expect(tokens.scope).toBe('write');
    const bearer = { authorization: `Bearer ${tokens.access_token}` };
    // MUT-436: a write-only grant gets the write tools and no read tool.
    const listed = await rpc(h, bearer, 'tools/list');
    const names = ((listed.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
    for (const name of READ_TOOLS) expect(names).not.toContain(name);
    const called = await rpc(h, bearer, 'tools/call', { name: 'list_profiles', arguments: {} });
    expect(called.error ?? called.result?.isError, JSON.stringify(called)).toBeTruthy();
    expect(called.result?.structuredContent).toBeUndefined();
  });
});

describe('list_profiles (AC1)', () => {
  it('lists the profiles the person owns or co-owns, and never one they only belong to', async () => {
    const { h, p, bearer } = await setup();
    const studio = await business(h, p);
    const other = await person(h);
    const shared = await business(h, other, 'Shared Co');
    expect((await h.app.request(`/admin/v1/users/${p.userId}/memberships`, json({ organizationId: shared, role: 'OWNER' }, ADMIN))).status).toBe(201);
    const firm = await memberOnlyProfile(h, p);

    const out = await tool(h, bearer, 'list_profiles');
    const byId = new Map((out.items as Loose[]).map((i) => [i.id, i]));
    expect([...byId.keys()].sort()).toEqual([p.personalId, studio, shared].sort());
    expect(byId.has(firm)).toBe(false);
    expect(byId.get(p.personalId)).toMatchObject({ type: 'personal', defaultCurrency: 'ILS', isPersonalDefault: true, coOwned: false });
    expect(byId.get(studio)).toMatchObject({ name: 'Studio', type: 'business', isPersonalDefault: false, coOwned: false });
    expect(byId.get(shared)).toMatchObject({ name: 'Shared Co', type: 'business', coOwned: true });
    expect(out.nextCursor).toBeNull();
  });
});

describe('profile-scoped tools refuse a profile the agent may not see (AC1)', () => {
  it('answers "not found" alike for a member-only profile, someone else’s profile and an unknown id', async () => {
    const { h, p, bearer } = await setup();
    const firm = await memberOnlyProfile(h, p);
    const stranger = await person(h);
    for (const profileId of [firm, stranger.personalId, '00000000-0000-4000-8000-000000000000']) {
      for (const [name, extra] of [['list_categories', {}], ['list_clients', {}], ['list_vendors', { q: 'a' }], ['find_similar_expenses', { amount: '1.00', currency: 'ILS', date: '2026-10-20' }]] as const) {
        expect(await toolError(h, bearer, name, { profileId, ...extra }), `${name} ${profileId}`).toContain('Profile not found');
      }
    }
  });
});

describe('list_categories', () => {
  it('lists a profile’s categories, archived ones only on request', async () => {
    const { h, p, bearer } = await setup();
    const studio = await business(h, p);
    const seeded = await read(await h.app.request('/v1/expense-categories', { headers: asPerson(p, studio) }));
    const first = seeded.items[0];
    expect((await h.app.request(`/v1/expense-categories/${first.id}`, json({ archived: true }, { ...asPerson(p, studio), 'if-match': String(first.version) }, 'PATCH'))).status).toBe(200);

    const live = await tool(h, bearer, 'list_categories', { profileId: studio });
    expect(live.items.map((c: Loose) => c.id)).not.toContain(first.id);
    const all = await tool(h, bearer, 'list_categories', { profileId: studio, includeArchived: true, limit: 50 });
    expect(all.items.find((c: Loose) => c.id === first.id)).toMatchObject({ archived: true });
  });

  it('never seeds a profile’s categories (a read writes nothing) and says how to get them', async () => {
    const { h, p, bearer } = await setup();
    expect(await h.store.expenseCategories.list(p.personalId, { includeArchived: true })).toHaveLength(0);
    const out = await tool(h, bearer, 'list_categories', { profileId: p.personalId });
    expect(await h.store.expenseCategories.list(p.personalId, { includeArchived: true })).toHaveLength(0);
    expect(out).toMatchObject({ items: [], hint: expect.stringContaining('open it in MTB3A') });
  });
});

describe('offset cursors (list_profiles, list_categories)', () => {
  it('walks a profile’s categories page by page and refuses a cursor no tool issued', async () => {
    const { h, p, bearer } = await setup();
    const studio = await business(h, p);
    const all = (await read(await h.app.request('/v1/expense-categories', { headers: asPerson(p, studio) }))).items as Loose[];
    expect(all.length).toBeGreaterThan(2);
    const first = await tool(h, bearer, 'list_categories', { profileId: studio, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const rest = await tool(h, bearer, 'list_categories', { profileId: studio, limit: 50, cursor: first.nextCursor });
    expect(rest.nextCursor).toBeNull();
    expect([...first.items, ...rest.items].map((c: Loose) => c.id)).toEqual(all.map((c) => c.id));
    const forged = Buffer.from(JSON.stringify({ o: -1 })).toString('base64url');
    for (const [name, args] of [['list_categories', { profileId: studio }], ['list_profiles', {}], ['list_inbox', {}]] as const) {
      expect(await toolError(h, bearer, name, { ...args, cursor: forged }), name).toMatch(/cursor/i);
      expect(await toolError(h, bearer, name, { ...args, cursor: 'not-a-cursor' }), name).toMatch(/cursor/i);
    }
  });
});

describe('list_clients (AC4)', () => {
  it('pages a profile’s clients with a cursor and caps the page size', async () => {
    const { h, p, bearer } = await setup();
    for (const name of ['Amal', 'Bassam', 'Carmel']) expect((await h.app.request('/v1/customers', json({ name }, asPerson(p, p.personalId)))).status).toBe(201);
    const gone = await read(await h.app.request('/v1/customers', json({ name: 'Dalia (archived)' }, asPerson(p, p.personalId))));
    expect(await h.store.customers.archive(p.personalId, gone.id, h.now())).not.toBeNull();

    const first = await tool(h, bearer, 'list_clients', { profileId: p.personalId, limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = await tool(h, bearer, 'list_clients', { profileId: p.personalId, limit: 2, cursor: first.nextCursor });
    expect(second).toMatchObject({ items: [expect.objectContaining({ name: expect.any(String) })], nextCursor: null });
    expect(new Set([...first.items, ...second.items].map((c: Loose) => c.name))).toEqual(new Set(['Amal', 'Bassam', 'Carmel']));

    expect(await toolError(h, bearer, 'list_clients', { profileId: p.personalId, limit: 51 })).toMatch(/limit/i);
    expect(await toolError(h, bearer, 'list_clients', { profileId: p.personalId, cursor: 'not-a-cursor' })).toMatch(/cursor/i);
  });
});

describe('list_vendors', () => {
  it('finds a saved vendor typed in Arabic, as typed', async () => {
    const { h, p, bearer } = await setup();
    await expense(h, p, p.personalId, { amount: '20.00', vendor: 'كارفور' });
    const out = await tool(h, bearer, 'list_vendors', { profileId: p.personalId, q: 'كار' });
    expect(out.items[0]).toMatchObject({ name: 'كارفور' });
    expect(out.truncated).toBe(false);
    expect(await tool(h, bearer, 'list_vendors', { profileId: p.personalId, q: 'كار', limit: 1 })).toMatchObject({ truncated: true });
  });
});

describe('list_inbox', () => {
  it('lists the person’s own unsorted entries, newest first, paged', async () => {
    const { h, p, bearer } = await setup();
    const older = await inbox(h, p, { amount: '10.00', note: 'taxi' });
    h.setNow(new Date(h.now().getTime() + 1000));
    const newer = await inbox(h, p, { amount: '30.00', note: 'lunch' });
    const stranger = await person(h);
    await inbox(h, stranger, { amount: '99.00' });

    const first = await tool(h, bearer, 'list_inbox', { limit: 1 });
    expect(first.items).toEqual([expect.objectContaining({ id: newer, kind: 'expense', amount: '30.00', currency: 'ILS', note: 'lunch' })]);
    const second = await tool(h, bearer, 'list_inbox', { limit: 1, cursor: first.nextCursor });
    expect(second.items.map((i: Loose) => i.id)).toEqual([older]);
    expect(second.nextCursor).toBeNull();
  });
});

describe('find_similar_expenses (AC2)', () => {
  it('finds the same purchase across the person’s profiles and inbox, best first, with reasons', async () => {
    const { h, p, bearer } = await setup();
    const studio = await business(h, p);
    const onStudio = await expense(h, p, studio, { amount: '45.90', vendor: 'Carrefour Market' });
    const inInbox = await inbox(h, p, { amount: '45.90' });
    await expense(h, p, p.personalId, { amount: '45.90', currency: 'USD' });
    await expense(h, p, p.personalId, { amount: '45.90', occurredOn: '2026-10-10' });
    const firm = await memberOnlyProfile(h, p);
    await h.store.expenses.create({ organizationId: firm, occurredOn: '2026-10-20', amountMinor: 4590n, currency: 'ILS', vendor: 'Carrefour', title: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: p.userId, vendorId: null } as Loose, h.now());

    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20', vendor: 'carrefour' });
    expect(out.items).toEqual([
      expect.objectContaining({ where: 'profile', profileId: studio, id: onStudio, amount: '45.90', currency: 'ILS', occurredOn: '2026-10-20', vendor: 'Carrefour Market', reasons: ['currency', 'amount', 'date', 'vendor'] }),
      expect.objectContaining({ where: 'inbox', profileId: null, id: inInbox, reasons: ['currency', 'amount', 'date'] }),
    ]);
    expect(out.truncated).toBe(false);

    const scoped = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20', profileId: p.personalId });
    expect(scoped.items).toEqual([]);
  });

  it('never offers an income inbox entry as a look-alike', async () => {
    const { h, p, bearer } = await setup();
    const income = await inbox(h, p, { kind: 'income', amount: '45.90', occurredOn: '2026-10-20' });
    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20' });
    expect(out.items.map((i: Loose) => i.id)).not.toContain(income);
  });

  it('says when a source had more candidates than it reads, and returns at most 10', async () => {
    const { h, p, bearer } = await setup();
    for (let i = 0; i < 201; i++) {
      await h.store.expenses.create({ organizationId: p.personalId, occurredOn: '2026-10-20', amountMinor: 4590n, currency: 'ILS', vendor: null, title: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: p.userId, vendorId: null } as Loose, h.now());
    }
    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20', profileId: p.personalId });
    expect(out.truncated).toBe(true);
    expect(out.items).toHaveLength(10);
  });

  it('refuses a date that is not a calendar date or is outside the ten-year bounds, naming `date`', async () => {
    const { h, bearer } = await setup();
    for (const date of ['2026-02-30', 'yesterday', '2015-01-01', '0099-01-01', '9999-12-31']) {
      expect(await toolError(h, bearer, 'find_similar_expenses', { amount: '1.00', currency: 'ILS', date }), date).toContain('"field":"date"');
    }
  });

  it('tells the agent which look-alikes already have a receipt and which can take one (MUT-437)', async () => {
    const { h, p, bearer } = await setup();
    const withReceipt = await expense(h, p, p.personalId, { amount: '45.90', vendor: 'Carrefour' });
    const bare = await expense(h, p, p.personalId, { amount: '45.90', vendor: 'Cafe Nero', occurredOn: '2026-10-21' });
    const captured = await inbox(h, p, { amount: '45.90' });
    const receipt = await h.store.expenseReceipts.create({ organizationId: p.personalId, expenseId: withReceipt, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-20', uploadedByUserId: p.userId, requestId: null }, h.now());
    await h.store.expenseReceipts.setKey(p.personalId, receipt.id, `org/${p.personalId}/expense-receipts/${receipt.id}`);
    await h.store.expenseReceipts.completeOnExpense({ organizationId: p.personalId, expenseId: withReceipt, receiptId: receipt.id, maxReceipts: 10 }, h.now());

    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20', vendor: 'Carrefour' });
    const byId = new Map(out.items.map((i: Loose) => [i.id, i]));
    expect(byId.get(withReceipt)).toMatchObject({ hasReceipt: true, canAttachReceipt: true, vendorMatch: 'similar' });
    expect(byId.get(bare)).toMatchObject({ hasReceipt: false, canAttachReceipt: true, vendorMatch: 'different' });
    expect(byId.get(captured)).toMatchObject({ where: 'inbox', hasReceipt: false, canAttachReceipt: false, vendorMatch: 'unknown' });
  });

  it('reads only same-amount rows, so many other purchases in the window never hide a match (MUT-437)', async () => {
    const { h, p, bearer } = await setup();
    for (let i = 0; i < 250; i++) {
      await h.store.expenses.create({ organizationId: p.personalId, occurredOn: '2026-10-20', amountMinor: 1000n + BigInt(i), currency: 'ILS', vendor: null, title: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: p.userId, vendorId: null } as Loose, h.now());
    }
    const hit = await expense(h, p, p.personalId, { amount: '45.90', occurredOn: '2026-10-18' });
    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20' });
    expect(out.items.map((i: Loose) => i.id)).toEqual([hit]);
    expect(out.truncated).toBe(false);
  });

  it('finds an inbox capture however many newer captures sit above it (TD-258)', async () => {
    const { h, p, bearer } = await setup();
    const old = await inbox(h, p, { amount: '45.90', occurredOn: '2026-10-19' });
    for (let i = 0; i < 205; i++) await h.store.inboxEntries.create({ userId: p.userId, kind: 'EXPENSE', amountMinor: 100n, currency: 'ILS', occurredOn: '2026-10-20', note: null, captureSource: 'app' }, h.now());
    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20' });
    expect(out.items.map((i: Loose) => i.id)).toEqual([old]);
    expect(out.truncated).toBe(false);
  });

  it('ranks an inbox capture by the vendor at the start of its note (review D16)', async () => {
    const { h, p, bearer } = await setup();
    const other = await expense(h, p, p.personalId, { amount: '45.90', vendor: 'Cafe Nero' });
    const noted = await inbox(h, p, { amount: '45.90', occurredOn: '2026-10-22', note: 'Starbucks · latte for the client' });
    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20', vendor: 'Starbucks' });
    expect(out.items.map((i: Loose) => i.id)).toEqual([noted, other]);
    expect(out.items[0]).toMatchObject({ vendor: 'Starbucks', vendorMatch: 'similar', title: 'Starbucks · latte for the client' });
  });

  it('reads a three-decimal currency in its own digits', async () => {
    const { h, p, bearer } = await setup();
    await expense(h, p, p.personalId, { amount: '12.345', currency: 'JOD' });
    const out = await tool(h, bearer, 'find_similar_expenses', { amount: '12.345', currency: 'JOD', date: '2026-10-22' });
    expect(out.items).toEqual([expect.objectContaining({ amount: '12.345', currency: 'JOD' })]);
    expect(await toolError(h, bearer, 'find_similar_expenses', { amount: '12.3456', currency: 'JOD', date: '2026-10-22' })).toMatch(/digits|amount/i);
  });
});

describe('the agent store guard applies inside tools (OV1)', () => {
  it('refuses a tool whose store method is not on the agent’s list', async () => {
    const { h, p, bearer } = await setup();
    const methods = AGENT_STORE_METHODS as Set<string>;
    methods.delete('vendors.search');
    try {
      // A refusal here is our bug (a tool calling outside the list): Sentry hears it, the agent gets a retry message.
      expect(await toolError(h, bearer, 'list_vendors', { profileId: p.personalId, q: 'a' })).toContain('MTB3A had a problem');
      expect(h.exceptions).toEqual([{ error: expect.objectContaining({ code: 'PRINCIPAL_NOT_ACCEPTED' }), context: expect.objectContaining({ route: 'mcp:list_vendors' }) }]);
    } finally {
      methods.add('vendors.search');
    }
  });
});

describe('errors', () => {
  it('turns an unexpected failure into a plain retry message without the internals', async () => {
    const { h, p, bearer } = await setup();
    vi.spyOn(h.store.vendors, 'search').mockRejectedValueOnce(new Error('connection to db-internal-7 lost'));
    const text = await toolError(h, bearer, 'list_vendors', { profileId: p.personalId, q: 'a' });
    expect(text).toContain('MTB3A had a problem');
    expect(text).not.toContain('db-internal');
    expect(h.exceptions).toEqual([{ error: expect.objectContaining({ message: 'connection to db-internal-7 lost' }), context: expect.objectContaining({ route: 'mcp:list_vendors' }) }]);
  });

  it('reports a result that drifted from its output schema instead of failing silently', async () => {
    const { h, p, bearer } = await setup();
    vi.spyOn(h.store.vendors, 'search').mockResolvedValueOnce([{ vendor: { id: 'v1', canonicalName: 42 }, matchedName: 'x', score: 1, exact: false } as Loose]);
    expect(await toolError(h, bearer, 'list_vendors', { profileId: p.personalId, q: 'a' })).toContain('MTB3A had a problem');
    expect(h.exceptions).toEqual([{ error: expect.objectContaining({ message: expect.stringContaining('list_vendors result does not match its output schema') }), context: expect.objectContaining({ route: 'mcp:list_vendors' }) }]);
  });
});

describe('one request is one call (review D1)', () => {
  it('refuses a JSON-RPC batch before any tool runs', async () => {
    const { h, bearer } = await setup();
    const search = vi.spyOn(h.store.expenses, 'list');
    const call = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'find_similar_expenses', arguments: { amount: '1.00', currency: 'ILS', date: '2026-10-20' } } });
    const res = await h.app.request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, ...bearer, 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify([call(1), call(2)]) });
    expect(res.status).toBe(400);
    expect((await read(res)).error).toMatchObject({ code: -32600, message: expect.stringContaining('batching') });
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps the SDK’s body cap and its parse error (re-review finding 1)', async () => {
    const { h, bearer } = await setup();
    const post = (body: string) => h.app.request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, ...bearer, 'mcp-protocol-version': '2025-06-18' }, body });
    const huge = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(5 * 1024 * 1024) } }));
    expect(huge.status).toBe(413);
    const broken = await post('{"jsonrpc": "2.0", "id": 1,');
    expect(broken.status).toBe(400);
    expect((await read(broken)).error.code).toBe(-32700);
    expect((await post(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }))).status).toBe(200);
  });
});

describe('a person’s connections share one budget (review D4)', () => {
  it('refuses the person once their agents together pass the per-person limit, whatever the connection', async () => {
    const h = harness({ agentLimit: 100, agentPersonLimit: 3 });
    const p = await person(h);
    const first = await connect(h, p);
    const second = await connect(h, p);
    const ping = (bearer: Record<string, string>) => h.app.request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, ...bearer, 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    expect((await ping(first.bearer)).status).toBe(200);
    expect((await ping(second.bearer)).status).toBe(200);
    expect((await ping(first.bearer)).status).toBe(200);
    const refused = await ping(second.bearer);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBeTruthy();
  });
});

describe('a profile LOCKED by billing (review D2)', () => {
  it('is refused by name and left out of the look-alike search, as the app does; read-only stays readable', async () => {
    const h = harness({ billingGate: true });
    const p = await person(h);
    const { bearer } = await connect(h, p);
    await h.store.billing.setTrialStart(p.userId, new Date(h.now().getTime() - 3 * 86_400_000));
    await expense(h, p, p.personalId, { amount: '45.90' });
    // Day 20 of the trial: read-only, still readable by the agent.
    await h.store.billing.setTrialStart(p.userId, new Date(h.now().getTime() - 20 * 86_400_000));
    expect((await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20' })).items).toHaveLength(1);
    // Day 31: locked.
    await h.store.billing.setTrialStart(p.userId, new Date(h.now().getTime() - 31 * 86_400_000));
    expect(await toolError(h, bearer, 'list_categories', { profileId: p.personalId })).toContain('SUBSCRIPTION_LAPSED');
    expect((await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-20' })).items).toEqual([]);
    // Every profile locked: the inbox follows, as the app's own inbox does (re-review finding 2).
    expect(await toolError(h, bearer, 'list_inbox')).toContain('SUBSCRIPTION_LAPSED');
  });
});

describe('every tool that takes a profile refuses a stranger’s (review D3)', () => {
  it('sweeps tools/list, so a tool added later is covered without a new test', async () => {
    const { h, bearer } = await setup();
    const stranger = await person(h);
    const { result } = await rpc(h, bearer, 'tools/list');
    const withProfile = (result.tools as Array<{ name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }>).filter((t) => t.inputSchema.properties?.profileId);
    expect(withProfile.length).toBeGreaterThan(0);
    // The smallest valid arguments for each, by hand: a new tool with a new required argument fails here until it is named.
    const minimal: Record<string, Record<string, unknown>> = {
      list_categories: {},
      list_clients: {},
      list_vendors: { q: 'a' },
      find_similar_expenses: { amount: '1.00', currency: 'ILS', date: '2026-10-20' },
      start_receipt_upload: { target: { kind: 'expense', expenseId: '00000000-0000-4000-8000-000000000001' }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 100, idempotencyKey: 'sweep-key-0001' },
      complete_receipt_upload: { receiptId: '00000000-0000-4000-8000-000000000002' },
    };
    for (const t of withProfile) {
      expect(minimal[t.name], `add ${t.name} to this sweep`).toBeDefined();
      expect(await toolError(h, bearer, t.name, { ...minimal[t.name], profileId: stranger.personalId }), t.name).toContain('Profile not found');
    }
    // add_expense names its profile inside destination.
    expect(await toolError(h, bearer, 'add_expense', { destination: { kind: 'profile', profileId: stranger.personalId }, amount: '1.00', currency: 'ILS', occurredOn: '2026-10-20', idempotencyKey: 'sweep-key-0003' })).toContain('Profile not found');
  });
});

describe('an offset cursor belongs to the call that issued it (review D5)', () => {
  it('refuses a cursor sent to another tool, another profile or another filter', async () => {
    const { h, p, bearer } = await setup();
    const studio = await business(h, p);
    const other = await business(h, p, 'Second');
    await h.app.request('/v1/expense-categories', { headers: asPerson(p, studio) });
    await h.app.request('/v1/expense-categories', { headers: asPerson(p, other) });
    const first = await tool(h, bearer, 'list_categories', { profileId: studio, limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(await toolError(h, bearer, 'list_categories', { profileId: other, limit: 1, cursor: first.nextCursor })).toMatch(/cursor/i);
    expect(await toolError(h, bearer, 'list_categories', { profileId: studio, limit: 1, includeArchived: true, cursor: first.nextCursor })).toMatch(/cursor/i);
    expect(await toolError(h, bearer, 'list_profiles', { limit: 1, cursor: first.nextCursor })).toMatch(/cursor/i);
    expect((await tool(h, bearer, 'list_categories', { profileId: studio, limit: 1, cursor: first.nextCursor })).items).toHaveLength(1);
  });
});
