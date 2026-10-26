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
    expect(out).toMatchObject({ where: 'inbox', profileId: null, amount: '45.90', replayed: false });
    const entries = (await read(await h.app.request('/v1/inbox', { headers: as(p) }))).items;
    expect(entries).toEqual([expect.objectContaining({ id: out.id, kind: 'expense', captureSource: 'mcp', note: 'كارفور · groceries' })]);
    expect(await toolError(h, bearer, 'add_expense', { ...expenseArgs(p.personalId), destination: { kind: 'inbox' }, categoryId: '00000000-0000-4000-8000-000000000001' })).toContain('file it to a profile');
  });
});

describe('add_expense to a profile (AC2)', () => {
  it('records the expense through the REST compose path, marked mcp, vendor as typed and linked, audited', async () => {
    const { h, p, bearer } = await setup();
    const out = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId, { vendor: 'שופרסל דיל', title: 'Weekly shop' }));
    expect(out).toMatchObject({ where: 'profile', profileId: p.personalId, amount: '45.90', vendor: 'שופרסל דיל', replayed: false });
    const [expense] = await expensesOf(h, p, p.personalId);
    expect(expense).toMatchObject({ id: out.id, captureSource: 'mcp', vendor: 'שופרסל דיל', vendorId: expect.any(String), title: 'Weekly shop' });
    const audit = await h.store.audit.list(p.personalId, { entityId: out.id }, { limit: 10, cursor: null });
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
    const expense = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
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
    const expense = await tool(off.h, off.bearer, 'add_expense', expenseArgs(off.p.personalId));
    await toolError(off.h, off.bearer, 'start_receipt_upload', { profileId: off.p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'x.html', mimeType: 'text/html', sizeBytes: 10, idempotencyKey: key() });
    await toolError(off.h, off.bearer, 'start_receipt_upload', { profileId: off.p.personalId, target: { kind: 'to_review' }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() });

    const on = await setup({ attachments: new MemoryAttachmentStorage(), receiptsLibrary: true });
    const toReview = await tool(on.h, on.bearer, 'start_receipt_upload', { profileId: on.p.personalId, target: { kind: 'to_review' }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() });
    expect(toReview.expenseId).toBeNull();
  });

  it('answers ATTACHMENTS_NOT_CONFIGURED where the deployment has no bucket', async () => {
    const { h, p, bearer } = await setup();
    const expense = await tool(h, bearer, 'add_expense', expenseArgs(p.personalId));
    expect(await toolError(h, bearer, 'start_receipt_upload', { profileId: p.personalId, target: { kind: 'expense', expenseId: expense.id }, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, idempotencyKey: key() })).toContain('ATTACHMENTS_NOT_CONFIGURED');
  });
});
