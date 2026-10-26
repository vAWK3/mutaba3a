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
    expect(first.structured).toMatchObject({ where: 'profile', amount: '45.90', replayed: false });
    expenseId = String(first.structured?.id);
    const again = await callTool(accessToken, 'add_expense', withDestination);
    expect(again.structured).toMatchObject({ id: expenseId, replayed: true });
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
      target: { kind: 'expense', expenseId: added.structured?.id },
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

