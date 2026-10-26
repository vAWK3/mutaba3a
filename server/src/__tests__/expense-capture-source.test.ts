import { describe, expect, it } from 'vitest';
import { harness, json, person, read, type Harness, type Person } from './helpers/oauth-agent.js';

/**
 * MUT-436 (ADR-201): an expense keeps where it was captured on the row, so the portal can mark "Added by Claude". A
 * client can send any phone source but never 'mcp' (only the MCP tools write it), and filing an inbox entry carries the
 * entry's source onto the expense it becomes (review R6).
 */
let seq = 0;
const as = (p: Person, profileId?: string) => ({ ...p.cookie, ...(profileId ? { 'x-mutaba3a-profile': profileId } : {}), 'idempotency-key': `mut436-source-${++seq}` });

async function postExpense(h: Harness, p: Person, extra: Record<string, unknown>) {
  return h.app.request('/v1/expenses', json({ occurredOn: '2026-10-20', amount: '12.00', currency: 'ILS', ...extra }, as(p, p.personalId)));
}

describe('an expense’s capture source', () => {
  it('keeps a phone source on the row and returns it; null when none was sent', async () => {
    const h = harness();
    const p = await person(h);
    const siri = await postExpense(h, p, { captureSource: 'siri' });
    expect(siri.status).toBe(201);
    const created = await read(siri);
    expect(created.captureSource).toBe('siri');
    expect((await read(await h.app.request(`/v1/expenses/${created.id}`, { headers: as(p, p.personalId) }))).captureSource).toBe('siri');
    expect((await read(await postExpense(h, p, {}))).captureSource).toBeNull();
  });

  it('refuses a client claiming mcp: only the MCP tools write it', async () => {
    const h = harness();
    const p = await person(h);
    expect((await postExpense(h, p, { captureSource: 'mcp' })).status).toBe(422);
  });

  it('carries an inbox entry’s source onto the expense it is filed as (review R6)', async () => {
    const h = harness();
    const p = await person(h);
    const entry = await read(await h.app.request('/v1/inbox', json({ kind: 'expense', amount: '30.00', currency: 'ILS', occurredOn: '2026-10-20', captureSource: 'widget' }, as(p))));
    const filed = await h.app.request(`/v1/inbox/${entry.id}/file-as-expense`, json({}, as(p, p.personalId)));
    expect(filed.status, JSON.stringify(await filed.clone().json())).toBe(201);
    const body = await read(filed);
    const expense = body.expense ?? body;
    expect(expense.captureSource).toBe('widget');
  });
});
