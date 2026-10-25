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
    const tools = (await mcpCall(accessToken, 'tools/list')).result?.tools as Array<{ name: string; description: string }>;
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
