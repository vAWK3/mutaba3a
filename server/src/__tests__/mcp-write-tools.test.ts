import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { DESTINATION_REQUIRED } from '../mcp/write-tools.js';
import { CLAUDE_CB, RESOURCE, VERIFIER, authorize, connect, form, harness, json, person, read, register, requestIdFrom, rpc, tool, toolError, type Harness, type Loose, type Person } from './helpers/oauth-agent.js';

/**
 * MUT-436: the write tools through the real /mcp with an OAuth token (the agent guard applies): add_expense with a
 * required destination (AC1), the inbox and profile rules it reuses (AC2), its idempotency key (AC3), receipts through
 * the shared upload path (AC4), and the capture source the portal marks (AC5's data).
 */
let seq = 0;
const key = () => `mut436-key-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const as = (p: Person, profileId?: string) => ({ ...p.cookie, ...(profileId ? { 'x-mutaba3a-profile': profileId } : {}), 'idempotency-key': `mut436-rest-${++seq}` });
const expenseArgs = (profileId: string, extra: Record<string, unknown> = {}) => ({ destination: { kind: 'profile', profileId }, amount: '45.90', currency: 'ILS', occurredOn: '2026-10-20', idempotencyKey: key(), ...extra });

async function setup(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  const p = await person(h);
  const agent = await connect(h, p);
  return { h, p, bearer: agent.bearer };
}

async function expensesOf(h: Harness, p: Person, profileId: string): Promise<Loose[]> {
  return (await read(await h.app.request('/v1/expenses', { headers: as(p, profileId) }))).items;
}

describe('add_expense: where it goes (AC1)', () => {
  it('refuses a call without destination with the instruction to ask, and writes nothing', async () => {
    const { h, p, bearer } = await setup();
    const { destination: _d, ...rest } = expenseArgs(p.personalId);
    void _d;
    expect(await toolError(h, bearer, 'add_expense', rest)).toContain(DESTINATION_REQUIRED);
    expect(await expensesOf(h, p, p.personalId)).toEqual([]);
  });

  it('offers no inbox destination while MCP_INBOX_WRITES is off, and refuses one sent anyway', async () => {
    const { h, p, bearer } = await setup();
    const { result } = await rpc(h, bearer, 'tools/list');
    const addExpense = (result.tools as Array<{ name: string; inputSchema: unknown }>).find((t) => t.name === 'add_expense')!;
    expect(JSON.stringify(addExpense.inputSchema)).not.toContain('"inbox"');
    await toolError(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), destination: { kind: 'inbox' } });
    expect((await read(await h.app.request('/v1/inbox', { headers: as(p) }))).items).toEqual([]);
  });

  it('with MCP_INBOX_WRITES on, adds to the person’s inbox marked mcp, and refuses links there', async () => {
    const { h, p, bearer } = await setup({ mcpInboxWrites: true });
    const out = await tool(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), destination: { kind: 'inbox' }, vendor: 'كارفور', notes: 'groceries' });
    expect(out).toMatchObject({ outcome: 'created', expense: { where: 'inbox', profileId: null, amount: '45.90' }, candidates: [], replayed: false });
    const entries = (await read(await h.app.request('/v1/inbox', { headers: as(p) }))).items;
    expect(entries).toEqual([expect.objectContaining({ id: out.expense.id, kind: 'expense', captureSource: 'mcp', note: 'كارفور · groceries' })]);
    expect(await toolError(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), destination: { kind: 'inbox' }, categoryId: '00000000-0000-4000-8000-000000000001' })).toContain('file it to a profile');
  });
});

describe('add_expense to a profile (AC2)', () => {
  it('records the expense through the REST compose path, marked mcp, vendor as typed and linked, audited', async () => {
    const { h, p, bearer } = await setup();
    const out = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId, { vendor: 'שופרסל דיל', title: 'Weekly shop' }));
    expect(out).toMatchObject({ outcome: 'created', expense: { where: 'profile', profileId: p.personalId, amount: '45.90', vendor: 'שופרסל דיל' }, replayed: false });
    const [expense] = await expensesOf(h, p, p.personalId);
    expect(expense).toMatchObject({ id: out.expense.id, captureSource: 'mcp', vendor: 'שופרסל דיל', vendorId: expect.any(String), title: 'Weekly shop' });
    // MUT-302 (D8, OV8): the tool takes no VAT, so its expense records none.
    expect(expense.vat).toBeNull();
    const row = await h.store.expenses.getById(p.personalId, out.expense.id);
    expect(row).toMatchObject({ vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null });
    const audit = await h.store.audit.list(p.personalId, { entityId: out.expense.id }, { limit: 10, cursor: null });
    expect(audit.items).toEqual([expect.objectContaining({ action: 'expense.created', actorType: 'USER', actorId: p.userId, metadata: expect.objectContaining({ captureSource: 'mcp', grantId: expect.any(String) }) })]);
  });

  it('refuses what POST /v1/expenses refuses: past the ten-year floor or ceiling, an archived category', async () => {
    const { h, p, bearer } = await setup();
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(p.personalId, { occurredOn: '2015-01-01' }))).toContain('DATE_INVALID');
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(p.personalId, { occurredOn: '2037-01-01' }))).toContain('DATE_INVALID');
    const categories = (await read(await h.app.request('/v1/expense-categories', { headers: as(p, p.personalId) }))).items as Loose[];
    const archived = categories[0];
    expect((await h.app.request(`/v1/expense-categories/${archived.id}`, json({ archived: true }, { ...as(p, p.personalId), 'if-match': String(archived.version) }, 'PATCH'))).status).toBe(200);
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(p.personalId, { categoryId: archived.id }))).toMatch(/categor/i);
    expect(await expensesOf(h, p, p.personalId)).toEqual([]);
  });

  it('refuses a profile whose plan has lapsed (the lapse gate), and the inbox when the person has no writable profile', async () => {
    const { h, p, bearer } = await setup({ billingGate: true, mcpInboxWrites: true });
    await h.store.billing.setTrialStart(p.userId, new Date(h.now().getTime() - 20 * 86_400_000));
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(p.personalId))).toContain('SUBSCRIPTION_LAPSED');
    expect(await toolError(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), destination: { kind: 'inbox' } })).toContain('SUBSCRIPTION_LAPSED');
  });
});

describe('the idempotency key (AC3)', () => {
  it('records nothing new on a retry with the same key, even after reconnecting; a different request on that key is refused', async () => {
    const { h, p, bearer } = await setup();
    const args = expenseArgs(p.personalId);
    const first = await tool(h, bearer, 'add_expense', args);
    const again = await tool(h, bearer, 'add_expense', args);
    expect(again).toEqual({ ...first, replayed: true });
    const reconnected = await connect(h, p);
    expect(await tool(h, reconnected.bearer, 'add_expense', args)).toEqual({ ...first, replayed: true });
    expect(await expensesOf(h, p, p.personalId)).toHaveLength(1);
    expect(await toolError(h, bearer, 'add_expense', { ...args, amount: '46.00' })).toContain('IDEMPOTENCY_KEY_REUSED');
  });

  it('replays a refusal as the same refusal (a 4xx is the call’s final answer)', async () => {
    const { h, p, bearer } = await setup();
    const args = expenseArgs(p.personalId, { occurredOn: '2015-01-01' });
    const first = await toolError(h, bearer, 'add_expense', args);
    expect(await toolError(h, bearer, 'add_expense', args)).toBe(first);
  });
});

describe('scopes', () => {
  it('a read-only grant is offered no write tool and cannot call one', async () => {
    const h = harness();
    const p = await person(h);
    const clientId = await register(h);
    const requestId = await requestIdFrom(await authorize(h, clientId, { scope: 'read' }));
    const decided = await read(await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie)));
    const code = new URL(decided.redirectTo).searchParams.get('code') ?? '';
    const tokens = await read(await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE })));
    const bearer = { authorization: `Bearer ${tokens.access_token}` };
    const names = ((await rpc(h, bearer, 'tools/list')).result.tools as Array<{ name: string }>).map((t) => t.name);
    for (const name of ['add_expense', 'start_receipt_upload', 'complete_receipt_upload']) expect(names).not.toContain(name);
    const called = await rpc(h, bearer, 'tools/call', { name: 'add_expense', arguments: expenseArgs(p.personalId) });
    expect(called.error ?? called.result?.isError).toBeTruthy();
    expect(await expensesOf(h, p, p.personalId)).toEqual([]);
  });
});

describe('receipts (AC4)', () => {
  it('starts an upload on an expense, and completes it once the object is there, filed and audited as mcp', async () => {
    const storage = new MemoryAttachmentStorage();
    const { h, p, bearer } = await setup({ attachments: storage });
    const { expense } = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
    const started = await tool(h, bearer, 'start_receipt_upload', { profileId: p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 1000, idempotencyKey: key() });
    expect(started).toMatchObject({ expenseId: expense.id, upload: { method: 'PUT', url: expect.stringContaining('memory://upload/') } });
    expect(await toolError(h, bearer, 'complete_receipt_upload', { profileId: p.personalId, receiptId: started.receiptId })).toContain('UPLOAD_INCOMPLETE');

    const stored = await h.store.expenseReceipts.getById(p.personalId, started.receiptId);
    storage.put(stored!.storageKey, { sizeBytes: 1000, contentType: 'application/pdf' });
    expect(await tool(h, bearer, 'complete_receipt_upload', { profileId: p.personalId, receiptId: started.receiptId })).toMatchObject({ status: 'READY', filingStatus: 'FILED', expenseId: expense.id });
    const audit = await h.store.audit.list(p.personalId, { entityId: started.receiptId }, { limit: 10, cursor: null });
    expect(audit.items).toEqual([expect.objectContaining({ action: 'expense_receipt.added', metadata: expect.objectContaining({ captureSource: 'mcp' }) })]);
  });

  it('refuses a file type outside PDF/JPEG/PNG, and offers To review only where the receipts library is on', async () => {
    const off = await setup({ attachments: new MemoryAttachmentStorage() });
    const { expense } = await tool(off.h, off.bearer, 'add_expense', expenseArgs(off.p.personalId));
    await toolError(off.h, off.bearer, 'start_receipt_upload', { profileId: off.p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'x.html', mimeType: 'text/html', sizeBytes: 10, idempotencyKey: key() });
    await toolError(off.h, off.bearer, 'start_receipt_upload', { profileId: off.p.personalId, target: { kind: 'to_review' }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() });

    const on = await setup({ attachments: new MemoryAttachmentStorage(), receiptsLibrary: true });
    const toReview = await tool(on.h, on.bearer, 'start_receipt_upload', { profileId: on.p.personalId, target: { kind: 'to_review' }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() });
    expect(toReview.expenseId).toBeNull();
  });

  it('lets one key per source document serve the expense and its receipt (the key is per tool)', async () => {
    const { h, p, bearer } = await setup({ attachments: new MemoryAttachmentStorage() });
    const sourceKey = key();
    const { expense } = await tool(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), idempotencyKey: sourceKey });
    const started = await tool(h, bearer, 'start_receipt_upload', { profileId: p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: sourceKey });
    expect(started).toMatchObject({ expenseId: expense.id, replayed: false });
  });

  it('caps an agent’s unfinished uploads on an expense as on the library (20 pending), with a 429', async () => {
    const { h, p, bearer } = await setup({ attachments: new MemoryAttachmentStorage() });
    const { expense } = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
    const start = () => rpc(h, bearer, 'tools/call', { name: 'start_receipt_upload', arguments: { profileId: p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() } });
    for (let i = 0; i < 20; i++) expect((await start()).result.isError, `start ${i}`).toBeFalsy();
    const refused = await start();
    expect(refused.result.isError).toBe(true);
    expect(JSON.stringify(refused.result.content)).toContain('TOO_MANY_PENDING_UPLOADS');
  });

  it('gives a replay a fresh upload URL once the first one expired, and audits completion with the grant', async () => {
    const storage = new MemoryAttachmentStorage();
    const { h, p, bearer } = await setup({ attachments: storage });
    const { expense } = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
    const args = { profileId: p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() };
    const first = await tool(h, bearer, 'start_receipt_upload', args);
    h.setNow(new Date(h.now().getTime() + 16 * 60_000));
    const again = await tool(h, bearer, 'start_receipt_upload', args);
    expect(again).toMatchObject({ receiptId: first.receiptId, replayed: true });
    expect(Date.parse(again.upload.expiresAt)).toBeGreaterThan(h.now().getTime());

    const stored = await h.store.expenseReceipts.getById(p.personalId, first.receiptId);
    storage.put(stored!.storageKey, { sizeBytes: 10, contentType: 'application/pdf' });
    await tool(h, bearer, 'complete_receipt_upload', { profileId: p.personalId, receiptId: first.receiptId });
    const audit = await h.store.audit.list(p.personalId, { entityId: first.receiptId }, { limit: 10, cursor: null });
    expect(audit.items[0]?.metadata).toMatchObject({ captureSource: 'mcp', grantId: expect.any(String), oauthClientId: expect.any(String) });
  });

  it('answers ATTACHMENTS_NOT_CONFIGURED where the deployment has no bucket', async () => {
    const { h, p, bearer } = await setup();
    const { expense } = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
    expect(await toolError(h, bearer, 'start_receipt_upload', { profileId: p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() })).toContain('ATTACHMENTS_NOT_CONFIGURED');
  });
});

/**
 * MUT-437: one purchase is one expense. Every agent expense write checks for look-alikes after validating and before
 * writing, under the person's write lock, and answers `matched` (nothing written, key released) when any exists.
 */
const raw = (organizationId: string, p: Person, over: Record<string, unknown> = {}) =>
  ({ organizationId, occurredOn: '2026-10-20', amountMinor: 4590n, currency: 'ILS', vendor: null, title: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: p.userId, vendorId: null, ...over }) as Loose;

async function business(h: Harness, p: Person): Promise<string> {
  const res = await h.app.request('/v1/profiles', json({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, as(p)));
  expect(res.status).toBe(201);
  return (await read(res)).id as string;
}

async function captured(h: Harness, p: Person, over: Record<string, unknown> = {}): Promise<string> {
  const entry = await h.store.inboxEntries.create({ userId: p.userId, kind: 'EXPENSE', amountMinor: 4590n, currency: 'ILS', occurredOn: '2026-10-21', note: 'Carrefour', captureSource: 'siri', ...over } as Loose, h.now());
  return entry.id;
}

describe('add_expense: one purchase is one expense (MUT-437 AC1, AC3)', () => {
  it('answers matched for a statement line already recorded from its receipt, writes nothing, and keeps the key for the retry', async () => {
    const { h, p, bearer } = await setup();
    const receiptFirst = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId, { vendor: 'Carrefour' }));
    const line = expenseArgs(p.personalId, { vendor: 'Zzyzx Market', occurredOn: '2026-10-22' });

    const matched = await tool(h, bearer, 'add_expense', line);
    expect(matched).toMatchObject({ outcome: 'matched', expense: null, replayed: false });
    expect(matched.candidates).toEqual([expect.objectContaining({ id: receiptFirst.expense.id, where: 'profile', daysApart: 2, vendorMatch: 'different', hasReceipt: false, canAttachReceipt: true })]);
    expect(await expensesOf(h, p, p.personalId)).toHaveLength(1);
    expect(await h.store.vendors.search(p.personalId, 'Zzyzx', 5)).toEqual([]);

    // The person says it is a different purchase: the same key now records it, and a retry replays that, never matching itself.
    const created = await tool(h, bearer, 'add_expense', { ...line, notDuplicateOf: [receiptFirst.expense.id] });
    expect(created).toMatchObject({ outcome: 'created', candidates: [], replayed: false });
    expect(await tool(h, bearer, 'add_expense', { ...line, notDuplicateOf: [receiptFirst.expense.id] })).toEqual({ ...created, replayed: true });
    expect(await tool(h, bearer, 'add_expense', line)).toEqual({ ...created, replayed: true });
    expect(await expensesOf(h, p, p.personalId)).toHaveLength(2);
  });

  it('returns every look-alike, a similar vendor first, and drops the ones the person already called different', async () => {
    const { h, p, bearer } = await setup();
    const nero = await h.store.expenses.create(raw(p.personalId, p, { vendor: 'Cafe Nero' }), h.now());
    const carrefour = await h.store.expenses.create(raw(p.personalId, p, { vendor: 'Carrefour', occurredOn: '2026-10-21' }), h.now());
    const args = expenseArgs(p.personalId, { vendor: 'Carrefour' });
    expect((await tool(h, bearer, 'add_expense', args)).candidates.map((c: Loose) => c.id)).toEqual([carrefour.id, nero.id]);
    const left = await tool(h, bearer, 'add_expense', { ...args, notDuplicateOf: [carrefour.id] });
    expect(left).toMatchObject({ outcome: 'matched', candidates: [expect.objectContaining({ id: nero.id })] });
    expect(await expensesOf(h, p, p.personalId)).toHaveLength(2);
  });

  it('shows ten look-alikes at a time, so a frequent same-price purchase is recorded once all are answered (review D12)', async () => {
    const { h, p, bearer } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 15; i++) ids.push((await h.store.expenses.create(raw(p.personalId, p), h.now())).id);
    const args = expenseArgs(p.personalId);
    const first = await tool(h, bearer, 'add_expense', args);
    expect(first.candidates).toHaveLength(10);
    const second = await tool(h, bearer, 'add_expense', { ...args, notDuplicateOf: first.candidates.map((c: Loose) => c.id) });
    expect(second.candidates).toHaveLength(5);
    expect(await tool(h, bearer, 'add_expense', { ...args, notDuplicateOf: ids })).toMatchObject({ outcome: 'created' });
  });

  it('finds the purchase in another profile and in the inbox, never offering an inbox entry for a receipt (review D4)', async () => {
    const { h, p, bearer } = await setup();
    const studio = await business(h, p);
    const there = await h.store.expenses.create(raw(studio, p), h.now());
    const waiting = await captured(h, p);
    const out = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
    expect(out.outcome).toBe('matched');
    expect(out.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: there.id, profileId: studio, canAttachReceipt: true }), expect.objectContaining({ id: waiting, where: 'inbox', canAttachReceipt: false })]),
    );
  });

  it('refuses what cannot be saved before asking about look-alikes (review D17)', async () => {
    const { h, p, bearer } = await setup();
    await h.store.expenses.create(raw(p.personalId, p), h.now());
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(p.personalId, { categoryId: '00000000-0000-4000-8000-000000000001' }))).toContain('CATEGORY_NOT_FOUND');
  });

  it('records one of two parallel calls for the same line and answers the other matched (review D15)', async () => {
    const { h, p, bearer } = await setup();
    const answers = await Promise.all([tool(h, bearer, 'add_expense', expenseArgs(p.personalId)), tool(h, bearer, 'add_expense', expenseArgs(p.personalId))]);
    expect(answers.map((a) => a.outcome).sort()).toEqual(['created', 'matched']);
    expect(await expensesOf(h, p, p.personalId)).toHaveLength(1);
  });

  it('checks an inbox add the same way (MCP_INBOX_WRITES on)', async () => {
    const { h, p, bearer } = await setup({ mcpInboxWrites: true });
    const existing = await h.store.expenses.create(raw(p.personalId, p), h.now());
    const out = await tool(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), destination: { kind: 'inbox' } });
    expect(out).toMatchObject({ outcome: 'matched', candidates: [expect.objectContaining({ id: existing.id })] });
    expect((await read(await h.app.request('/v1/inbox', { headers: as(p) }))).items).toEqual([]);
  });

  it('lets the receipt of a statement-first expense attach to it (AC2)', async () => {
    const storage = new MemoryAttachmentStorage();
    const { h, p, bearer } = await setup({ attachments: storage });
    const line = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId, { vendor: 'CARREFOUR 0231' }));
    const [lookAlike] = (await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-19', vendor: 'كارفور' })).items;
    expect(lookAlike).toMatchObject({ id: line.expense.id, hasReceipt: false, canAttachReceipt: true });
    const started = await tool(h, bearer, 'start_receipt_upload', { profileId: p.personalId, target: { kind: 'expense', expenseId: lookAlike.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() });
    storage.put((await h.store.expenseReceipts.getById(p.personalId, started.receiptId))!.storageKey, { sizeBytes: 10, contentType: 'application/pdf' });
    await tool(h, bearer, 'complete_receipt_upload', { profileId: p.personalId, receiptId: started.receiptId });
    expect((await tool(h, bearer, 'find_similar_expenses', { amount: '45.90', currency: 'ILS', date: '2026-10-19' })).items[0]).toMatchObject({ id: line.expense.id, hasReceipt: true });
  });
});

describe('file_inbox_entry (MUT-437, review D7/D10/D13)', () => {
  const fileArgs = (inboxEntryId: string, profileId: string, extra: Record<string, unknown> = {}) => ({ inboxEntryId, profileId, idempotencyKey: key(), ...extra });

  it('files a captured entry to a profile with MCP_INBOX_WRITES off, keeping its source, audited with the grant; the receipt then attaches', async () => {
    const storage = new MemoryAttachmentStorage();
    const { h, p, bearer } = await setup({ attachments: storage });
    const entryId = await captured(h, p);
    const args = fileArgs(entryId, p.personalId, { vendor: 'Carrefour', title: 'Groceries' });
    const out = await tool(h, bearer, 'file_inbox_entry', args);
    expect(out).toMatchObject({ outcome: 'created', expense: { where: 'profile', profileId: p.personalId, amount: '45.90', occurredOn: '2026-10-21', vendor: 'Carrefour' }, replayed: false });
    expect(await tool(h, bearer, 'file_inbox_entry', args)).toEqual({ ...out, replayed: true });
    expect(await h.store.inboxEntries.getById(p.userId, entryId)).toBeNull();
    const [expense] = await expensesOf(h, p, p.personalId);
    expect(expense).toMatchObject({ id: out.expense.id, captureSource: 'siri', notes: 'Carrefour', title: 'Groceries' });
    const audit = await h.store.audit.list(p.personalId, { entityId: out.expense.id }, { limit: 10, cursor: null });
    expect(audit.items[0]?.metadata).toMatchObject({ filedFromInbox: true, captureSource: 'siri', grantId: expect.any(String), oauthClientId: expect.any(String) });

    const started = await tool(h, bearer, 'start_receipt_upload', { profileId: p.personalId, target: { kind: 'expense', expenseId: out.expense.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() });
    expect(started.expenseId).toBe(out.expense.id);
  });

  it('answers matched when the profile already has the purchase, and files it once the person says it is different', async () => {
    const { h, p, bearer } = await setup();
    const existing = await h.store.expenses.create(raw(p.personalId, p, { vendor: 'Carrefour' }), h.now());
    const entryId = await captured(h, p);
    const args = fileArgs(entryId, p.personalId);
    const matched = await tool(h, bearer, 'file_inbox_entry', args);
    expect(matched).toMatchObject({ outcome: 'matched', candidates: [expect.objectContaining({ id: existing.id })] });
    expect(matched.candidates.map((c: Loose) => c.id)).not.toContain(entryId);
    expect(await h.store.inboxEntries.getById(p.userId, entryId)).not.toBeNull();
    expect(await tool(h, bearer, 'file_inbox_entry', { ...args, notDuplicateOf: [existing.id] })).toMatchObject({ outcome: 'created' });
  });

  it('refuses what the filing route refuses: another person’s entry, an income entry, a lapsed plan', async () => {
    const { h, p, bearer } = await setup();
    const stranger = await person(h);
    expect(await toolError(h, bearer, 'file_inbox_entry', fileArgs(await captured(h, stranger), p.personalId))).toContain('NOT_FOUND');
    expect(await toolError(h, bearer, 'file_inbox_entry', fileArgs(await captured(h, p, { kind: 'INCOME' }), p.personalId))).toContain('ENTRY_KIND_MISMATCH');
    const lapsed = await setup({ billingGate: true });
    await lapsed.h.store.billing.setTrialStart(lapsed.p.userId, new Date(lapsed.h.now().getTime() - 20 * 86_400_000));
    expect(await toolError(lapsed.h, lapsed.bearer, 'file_inbox_entry', fileArgs(await captured(lapsed.h, lapsed.p), lapsed.p.personalId))).toContain('SUBSCRIPTION_LAPSED');
  });
});

describe('scopes (MUT-437, review D14)', () => {
  it('a write-only grant is offered no write tool, so a matched answer never shows records it cannot read', async () => {
    const h = harness();
    const p = await person(h);
    const clientId = await register(h);
    const requestId = await requestIdFrom(await authorize(h, clientId, { scope: 'write' }));
    const decided = await read(await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie)));
    const code = new URL(decided.redirectTo).searchParams.get('code') ?? '';
    const tokens = await read(await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: CLAUDE_CB, resource: RESOURCE })));
    const bearer = { authorization: `Bearer ${tokens.access_token}` };
    // With no read scope the server has no tools at all, so tools/list itself is refused.
    const listed = await rpc(h, bearer, 'tools/list');
    const names = ((listed.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
    for (const name of ['add_expense', 'file_inbox_entry', 'start_receipt_upload', 'complete_receipt_upload']) expect(names).not.toContain(name);
    const called = await rpc(h, bearer, 'tools/call', { name: 'add_expense', arguments: expenseArgs(p.personalId) });
    expect(called.error ?? called.result?.isError).toBeTruthy();
    expect(await expensesOf(h, p, p.personalId)).toEqual([]);
  });
});
