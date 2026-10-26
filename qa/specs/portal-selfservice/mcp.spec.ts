import { randomUUID } from 'node:crypto';
import { test, expect } from '../../support/qa';
import { connect, mcpCall, person } from '../../support/agent';
import { chooseLanguage, grantCoverage, liveState } from '../../support/selfService';

/**
 * MUT-435: a connected agent's read tools, against the live dev API (support/selfservice-live.mjs). The person records
 * an expense with their signed-in session; the agent (fetch, support/agent.ts) lists its tools and profiles and finds
 * that expense as the look-alike of the purchase it is about to add.
 */

const READ_TOOLS = ['find_similar_expenses', 'list_categories', 'list_clients', 'list_inbox', 'list_profiles', 'list_vendors'];

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
});

test('A connected Claude lists my profiles and finds an expense I already recorded', { tag: '@portal-selfservice.mcp.read-tools' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  // The live API gates writes on billing (ADR-181); a pilot comp covers the person's own profiles.
  await grantCoverage(me.id);
  let accessToken = '';
  await step('Connect an agent', async () => {
    accessToken = await connect(page);
  });
  let expenseId = '';
  await step('Record a 45.90 ILS expense at Carrefour on the personal profile', async () => {
    const res = await page.request.post(`${liveState().origin}/v1/expenses`, {
      headers: { origin: liveState().origin, 'x-mutaba3a-profile': me.profileId, 'idempotency-key': `qa-mcp-${randomUUID()}` },
      data: { occurredOn: '2026-10-20', amount: '45.90', currency: 'ILS', vendor: 'Carrefour' },
    });
    expect(res.status(), await res.text()).toBe(201);
    expenseId = ((await res.json()) as { id: string }).id;
  });
  await step('The agent lists its tools and my profiles', async () => {
    // MUT-436: a read+write grant is offered the write tools too; these are the read ones.
    const tools = ((await mcpCall(accessToken, 'tools/list')).result?.tools as Array<{ name: string; description: string }>).filter((t) => READ_TOOLS.includes(t.name));
    expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
    for (const t of tools) expect(t.description, t.name).toContain('Show the person what you found');
    const profiles = (await mcpCall(accessToken, 'tools/call', { name: 'list_profiles', arguments: {} })).result?.structuredContent as { items: Array<{ id: string; defaultCurrency: string; isPersonalDefault: boolean }> };
    expect(profiles.items).toContainEqual(expect.objectContaining({ id: me.profileId, isPersonalDefault: true, defaultCurrency: expect.any(String) }));
  });
  await step('The agent asks whether a 45.90 ILS purchase at carrefour that day is already recorded', async () => {
    const found = (await mcpCall(accessToken, 'tools/call', { name: 'find_similar_expenses', arguments: { amount: '45.90', currency: 'ILS', date: '2026-10-20', vendor: 'carrefour' } })).result?.structuredContent as { items: Array<Record<string, unknown>> };
    expect(found.items[0]).toMatchObject({ where: 'profile', profileId: me.profileId, id: expenseId, amount: '45.90', vendor: 'Carrefour', reasons: ['currency', 'amount', 'date', 'vendor'] });
  });
});

/** One tools/call as the agent: the structured result, or the error text. */
async function callTool(accessToken: string, name: string, args: Record<string, unknown>) {
  const { result } = await mcpCall(accessToken, 'tools/call', { name, arguments: args });
  const text = ((result?.content as Array<{ text: string }> | undefined) ?? []).map((c) => c.text).join('\n');
  return { isError: Boolean(result?.isError), text, structured: result?.structuredContent as Record<string, unknown> | undefined };
}

/** Expenses lists date, title, category, client and amount (not the vendor): open the row by its amount. */
async function openExpense(page: import('@playwright/test').Page, profileId: string, amount: string) {
  await page.goto(`/p/${profileId}/expenses`);
  await page.getByRole('row').filter({ hasText: amount }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('Claude asks where an expense goes, adds it to my profile, and the drawer says "Added by Claude"', { tag: '@portal-selfservice.mcp.add-expense' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  await grantCoverage(me.id);
  const accessToken = await connect(page);
  const args = { amount: '45.90', currency: 'ILS', occurredOn: '2026-10-20', vendor: 'Carrefour', idempotencyKey: `qa-mcp-${randomUUID()}` };
  await step('Claude tries to add an expense without saying where it goes', async () => {
    const refused = await callTool(accessToken, 'add_expense', args);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Ask the person whether this goes to their inbox or to one of their profiles');
  });
  let expenseId = '';
  await step('Claude adds a 45.90 ILS expense at Carrefour to my personal profile, then retries the same call', async () => {
    const withDestination = { ...args, destination: { kind: 'profile', profileId: me.profileId } };
    const first = await callTool(accessToken, 'add_expense', withDestination);
    expect(first.isError, first.text).toBe(false);
    expect(first.structured).toMatchObject({ outcome: 'created', expense: { where: 'profile', amount: '45.90' }, replayed: false });
    expenseId = String((first.structured?.expense as { id: string }).id);
    const again = await callTool(accessToken, 'add_expense', withDestination);
    expect(again.structured).toMatchObject({ expense: { id: expenseId }, replayed: true });
  });
  await step('Open that expense in Expenses: it says "Added by Claude"', async () => {
    await openExpense(page, me.profileId, '45.90');
    await expect(page.getByRole('dialog').getByText('Added by', { exact: false })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Claude', { exact: true })).toBeVisible();
  });
});

test('Claude uploads a receipt to an expense it added, and the receipt shows on the expense', { tag: '@portal-selfservice.mcp.receipt-upload' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  await grantCoverage(me.id);
  const accessToken = await connect(page);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'utf8');
  let receiptId = '';
  let upload: { url: string; headers: Record<string, string> } = { url: '', headers: {} };
  await step('Claude adds an expense and starts a receipt upload for it', async () => {
    const added = await callTool(accessToken, 'add_expense', { destination: { kind: 'profile', profileId: me.profileId }, amount: '12.50', currency: 'ILS', occurredOn: '2026-10-21', vendor: 'Shufersal', idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(added.isError, added.text).toBe(false);
    const started = await callTool(accessToken, 'start_receipt_upload', {
      profileId: me.profileId,
      target: { kind: 'expense', expenseId: (added.structured?.expense as { id: string }).id },
      filename: 'shufersal-receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      idempotencyKey: `qa-mcp-${randomUUID()}`,
    });
    expect(started.isError, started.text).toBe(false);
    receiptId = String(started.structured?.receiptId);
    upload = started.structured?.upload as typeof upload;
  });
  await step('Claude sends the file to the upload address and finishes the upload', async () => {
    const put = await fetch(new URL(upload.url, liveState().origin), { method: 'PUT', headers: upload.headers, body: pdf });
    expect(put.ok, `PUT ${put.status}`).toBe(true);
    const done = await callTool(accessToken, 'complete_receipt_upload', { profileId: me.profileId, receiptId });
    expect(done.isError, done.text).toBe(false);
    expect(done.structured).toMatchObject({ status: 'READY', filingStatus: 'FILED' });
  });
  await step('Open that expense in Expenses: the receipt is listed', async () => {
    await openExpense(page, me.profileId, '12.50');
    await expect(page.getByRole('dialog').getByText('shufersal-receipt.pdf')).toBeVisible();
  });
});

/** The person's own capture, as the phone sends it: an unsorted expense in their inbox. */
async function captureInInbox(page: import('@playwright/test').Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post(`${liveState().origin}/v1/inbox`, {
    headers: { origin: liveState().origin, 'idempotency-key': `qa-mcp-${randomUUID()}` },
    data: { kind: 'expense', currency: 'ILS', ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test('Claude gives back the expense I already recorded instead of adding the statement line twice', { tag: '@portal-selfservice.mcp.statement-match' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  await grantCoverage(me.id);
  const accessToken = await connect(page);
  let receiptExpenseId = '';
  await step('Claude adds a 45.90 ILS expense at Carrefour from its receipt', async () => {
    const added = await callTool(accessToken, 'add_expense', { destination: { kind: 'profile', profileId: me.profileId }, amount: '45.90', currency: 'ILS', occurredOn: '2026-10-20', vendor: 'Carrefour', idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(added.structured, added.text).toMatchObject({ outcome: 'created' });
    receiptExpenseId = (added.structured?.expense as { id: string }).id;
  });
  const line = { destination: { kind: 'profile', profileId: me.profileId }, amount: '45.90', currency: 'ILS', occurredOn: '2026-10-22', vendor: 'CARREFOUR MKT 0231', idempotencyKey: `qa-mcp-${randomUUID()}` };
  await step('Claude adds the card statement line for the same purchase, two days later', async () => {
    const matched = await callTool(accessToken, 'add_expense', line);
    expect(matched.isError, matched.text).toBe(false);
    expect(matched.structured).toMatchObject({ outcome: 'matched', expense: null, candidates: [expect.objectContaining({ id: receiptExpenseId, canAttachReceipt: true })] });
  });
  await step('I say it is a different purchase, and Claude retries with the same key', async () => {
    const created = await callTool(accessToken, 'add_expense', { ...line, notDuplicateOf: [receiptExpenseId] });
    expect(created.structured, created.text).toMatchObject({ outcome: 'created', replayed: false });
  });
  await step('Expenses shows the two purchases', async () => {
    await page.goto(`/p/${me.profileId}/expenses`);
    await expect(page.getByRole('row').filter({ hasText: '45.90' })).toHaveCount(2);
  });
});

test('Claude files my phone capture from the inbox into a profile and attaches the receipt to it', { tag: '@portal-selfservice.mcp.file-inbox-entry' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  await grantCoverage(me.id);
  const accessToken = await connect(page);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'utf8');
  let entryId = '';
  await step('I capture 33.20 ILS on the phone; it waits in my inbox', async () => {
    entryId = await captureInInbox(page, { amount: '33.20', occurredOn: '2026-10-21', note: 'Super-Pharm' });
  });
  let expenseId = '';
  await step('Claude finds it as the look-alike of my receipt and files it to my personal profile', async () => {
    const found = await callTool(accessToken, 'find_similar_expenses', { amount: '33.20', currency: 'ILS', date: '2026-10-21', vendor: 'Super-Pharm' });
    expect(found.structured?.items).toEqual([expect.objectContaining({ id: entryId, where: 'inbox', canAttachReceipt: false })]);
    const filed = await callTool(accessToken, 'file_inbox_entry', { inboxEntryId: entryId, profileId: me.profileId, vendor: 'Super-Pharm', idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(filed.structured, filed.text).toMatchObject({ outcome: 'created', expense: { where: 'profile', amount: '33.20' } });
    expenseId = (filed.structured?.expense as { id: string }).id;
  });
  await step('Claude uploads the receipt to the filed expense', async () => {
    const started = await callTool(accessToken, 'start_receipt_upload', { profileId: me.profileId, target: { kind: 'expense', expenseId }, filename: 'super-pharm.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(started.isError, started.text).toBe(false);
    const upload = started.structured?.upload as { url: string; headers: Record<string, string> };
    const put = await fetch(new URL(upload.url, liveState().origin), { method: 'PUT', headers: upload.headers, body: pdf });
    expect(put.ok, `PUT ${put.status}`).toBe(true);
    const done = await callTool(accessToken, 'complete_receipt_upload', { profileId: me.profileId, receiptId: String(started.structured?.receiptId) });
    expect(done.structured, done.text).toMatchObject({ status: 'READY', filingStatus: 'FILED' });
  });
  await step('Open that expense in Expenses: the receipt is listed', async () => {
    await openExpense(page, me.profileId, '33.20');
    await expect(page.getByRole('dialog').getByText('super-pharm.pdf')).toBeVisible();
  });
});

test('Claude attaches my receipt to the expense it already recorded from my card statement', { tag: '@portal-selfservice.mcp.receipt-matches-statement' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  await grantCoverage(me.id);
  const accessToken = await connect(page);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'utf8');
  let lineId = '';
  await step('Claude records the card statement line: 61.40 ILS at CARREFOUR MKT 0231', async () => {
    const added = await callTool(accessToken, 'add_expense', { destination: { kind: 'profile', profileId: me.profileId }, amount: '61.40', currency: 'ILS', occurredOn: '2026-10-22', vendor: 'CARREFOUR MKT 0231', idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(added.structured, added.text).toMatchObject({ outcome: 'created' });
    lineId = (added.structured?.expense as { id: string }).id;
  });
  await step('Claude reads my Arabic receipt from two days earlier and finds that expense as its match', async () => {
    const found = await callTool(accessToken, 'find_similar_expenses', { amount: '61.40', currency: 'ILS', date: '2026-10-20', vendor: 'كارفور' });
    expect(found.structured?.items).toEqual([expect.objectContaining({ id: lineId, where: 'profile', canAttachReceipt: true, hasReceipt: false })]);
  });
  await step('Claude attaches the receipt to that expense', async () => {
    const started = await callTool(accessToken, 'start_receipt_upload', { profileId: me.profileId, target: { kind: 'expense', expenseId: lineId }, filename: 'carrefour-receipt.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(started.isError, started.text).toBe(false);
    const upload = started.structured?.upload as { url: string; headers: Record<string, string> };
    const put = await fetch(new URL(upload.url, liveState().origin), { method: 'PUT', headers: upload.headers, body: pdf });
    expect(put.ok, `PUT ${put.status}`).toBe(true);
    const done = await callTool(accessToken, 'complete_receipt_upload', { profileId: me.profileId, receiptId: String(started.structured?.receiptId) });
    expect(done.structured, done.text).toMatchObject({ status: 'READY', expenseId: lineId });
  });
  await step('Open that expense in Expenses: one 61.40 expense, with the receipt listed', async () => {
    await page.goto(`/p/${me.profileId}/expenses`);
    await expect(page.getByRole('row').filter({ hasText: '61.40' })).toHaveCount(1);
    await openExpense(page, me.profileId, '61.40');
    await expect(page.getByRole('dialog').getByText('carrefour-receipt.pdf')).toBeVisible();
  });
});

test('Claude shows me every look-alike and records nothing until I choose', { tag: '@portal-selfservice.mcp.several-matches' }, async ({ page, step }) => {
  const me = await person(page, { agentAccess: true });
  await grantCoverage(me.id);
  const accessToken = await connect(page);
  const ids: string[] = [];
  await step('I already have two 18.00 ILS expenses that week: Aroma and Cafe Nero', async () => {
    for (const [vendor, occurredOn] of [['Aroma', '2026-10-20'], ['Cafe Nero', '2026-10-21']]) {
      const res = await page.request.post(`${liveState().origin}/v1/expenses`, {
        headers: { origin: liveState().origin, 'x-mutaba3a-profile': me.profileId, 'idempotency-key': `qa-mcp-${randomUUID()}` },
        data: { occurredOn, amount: '18.00', currency: 'ILS', vendor },
      });
      expect(res.status(), await res.text()).toBe(201);
      ids.push(((await res.json()) as { id: string }).id);
    }
  });
  await step('Claude adds an 18.00 ILS statement line at AROMA TLV', async () => {
    const matched = await callTool(accessToken, 'add_expense', { destination: { kind: 'profile', profileId: me.profileId }, amount: '18.00', currency: 'ILS', occurredOn: '2026-10-21', vendor: 'AROMA TLV', idempotencyKey: `qa-mcp-${randomUUID()}` });
    expect(matched.isError, matched.text).toBe(false);
    expect(matched.structured).toMatchObject({ outcome: 'matched', expense: null });
    expect((matched.structured?.candidates as Array<{ id: string }>).map((c) => c.id)).toEqual([ids[0], ids[1]]);
  });
  await step('Expenses still shows only my two 18.00 expenses', async () => {
    await page.goto(`/p/${me.profileId}/expenses`);
    await expect(page.getByRole('row').filter({ hasText: '18.00' })).toHaveCount(2);
  });
});
