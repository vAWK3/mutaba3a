import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { PORTAL_ROUTES, type PortalRouteDependencies } from '../routes/portal-routes.js';

/**
 * One entry per call `src/hosted/api/client.ts` makes (mut-285 brief §3, the
 * "49 of 49" table, plus MUT-286's 50th and MUT-318's 51st: Add «name» in the client and matter pickers),
 * hand-maintained rather than parsed from the client file
 * (MUT-286 Phase A item 4 — simpler, at the cost of staying in sync by hand:
 * a future portal call that isn't added here won't be caught, but a future
 * drop from `PORTAL_ROUTES` that still leaves a call here will be).
 *
 * `local: false` marks the brief's "Remote only" rows (sign-in/out, password
 * change, account-setup, Malafat suggestions) — the portal's local transport
 * never calls them (Phase C item 2), so they are never expected to appear in
 * `PORTAL_ROUTES`. Paths use Hono's `:param` syntax, matching `app.routes`.
 */
interface ClientCall {
  method: string;
  path: string;
  local: boolean;
}

const CLIENT_CALLS: readonly ClientCall[] = [
  { method: 'GET', path: '/v1/me', local: true }, // 1
  { method: 'POST', path: '/v1/sessions', local: false }, // 2 — remote only; a successful sign-in switches the mode to remote
  { method: 'DELETE', path: '/v1/sessions/current', local: false }, // 3 — remote only; sign-out switches to local
  { method: 'POST', path: '/v1/me/password', local: false }, // 4 — remote only; account drawers are hidden locally
  { method: 'POST', path: '/v1/account-setup/check', local: false }, // 5 — remote only (/setup is a public server page)
  { method: 'POST', path: '/v1/account-setup', local: false }, // 6 — remote only
  { method: 'PATCH', path: '/v1/me/malafat-suggestions', local: false }, // 7 — not served locally; Malafat surfaces are hidden on local profiles
  { method: 'PATCH', path: '/v1/me/trial-prompt', local: false }, // 7d — remote only (MUT-418): a device has no trial, so nothing asks
  { method: 'PATCH', path: '/v1/me/passkey-prompt', local: false }, // 7e — remote only (MUT-370): local mode has no passkeys, /v1/me says passkeyPrompt: null
  { method: 'POST', path: '/v1/me/terms-acceptance', local: false }, // 7a — remote only (MUT-324): signed out, /v1/me says terms: null and nothing asks
  { method: 'GET', path: '/v1/records-export', local: false }, // 7b — remote only (MUT-325): signed out, Your data writes the same file from the device
  { method: 'GET', path: '/v1/records-export/receipts/:receiptId', local: false }, // 7c — remote only (MUT-325)
  { method: 'GET', path: '/v1/summaries/organization', local: true }, // 8
  { method: 'GET', path: '/v1/summaries/customers/:customerId', local: true }, // 9
  { method: 'GET', path: '/v1/customers', local: true }, // 10
  { method: 'GET', path: '/v1/customers/:customerId', local: true }, // 11
  { method: 'GET', path: '/v1/projects', local: true }, // 12
  { method: 'GET', path: '/v1/receivables', local: true }, // 13
  { method: 'GET', path: '/v1/receivables/:receivableId', local: true }, // 14
  { method: 'GET', path: '/v1/payments', local: true }, // 15
  { method: 'GET', path: '/v1/payments/:paymentId', local: true }, // 16
  { method: 'GET', path: '/v1/attachments', local: true }, // 17
  { method: 'GET', path: '/v1/attachments/:attachmentId/download', local: true }, // 18
  { method: 'GET', path: '/v1/expenses', local: true }, // 19
  { method: 'GET', path: '/v1/expenses/:expenseId', local: true }, // 20
  { method: 'POST', path: '/v1/expenses', local: true }, // 21
  { method: 'PATCH', path: '/v1/expenses/:expenseId', local: true }, // 22
  { method: 'DELETE', path: '/v1/expenses/:expenseId', local: true }, // 23
  { method: 'GET', path: '/v1/expense-categories', local: true }, // 24
  { method: 'POST', path: '/v1/expenses/:expenseId/receipts', local: true }, // 25 (25b, the client's PUT to the signed URL, is not a /v1 route)
  { method: 'POST', path: '/v1/expenses/:expenseId/receipts/:receiptId/complete', local: true }, // 26
  { method: 'DELETE', path: '/v1/expenses/:expenseId/receipts/:receiptId', local: true }, // 27
  { method: 'GET', path: '/v1/expenses/:expenseId/receipts/:receiptId/download', local: true }, // 28
  { method: 'POST', path: '/v1/income', local: true }, // 29
  { method: 'POST', path: '/v1/receivables/:receivableId/settle', local: true }, // 30
  { method: 'PATCH', path: '/v1/income/:incomeId', local: true }, // 31
  { method: 'PATCH', path: '/v1/payments/:paymentId', local: true }, // 32
  { method: 'POST', path: '/v1/profiles', local: true }, // 33
  { method: 'PATCH', path: '/v1/profiles/:profileId', local: true }, // 34
  { method: 'GET', path: '/v1/profiles/:profileId/type-change', local: true }, // 35
  { method: 'GET', path: '/v1/conversions', local: true }, // 36
  { method: 'GET', path: '/v1/conversions/:conversionId', local: true }, // 37
  { method: 'POST', path: '/v1/conversions', local: true }, // 38
  { method: 'PATCH', path: '/v1/conversions/:conversionId', local: true }, // 39
  { method: 'DELETE', path: '/v1/conversions/:conversionId', local: true }, // 40
  { method: 'GET', path: '/v1/expense-groups', local: true }, // 41
  { method: 'GET', path: '/v1/expense-groups/:groupId', local: true }, // 42
  { method: 'POST', path: '/v1/expense-groups', local: true }, // 43
  { method: 'PATCH', path: '/v1/expense-groups/:groupId', local: true }, // 44
  { method: 'DELETE', path: '/v1/expense-groups/:groupId', local: true }, // 45
  { method: 'GET', path: '/v1/expense-groups/:groupId/summary', local: true }, // 46
  { method: 'PUT', path: '/v1/expense-groups/:groupId/expenses/:expenseId', local: true }, // 47
  { method: 'DELETE', path: '/v1/expense-groups/:groupId/expenses/:expenseId', local: true }, // 48
  { method: 'GET', path: '/v1/fx-rates', local: true }, // 49
  { method: 'POST', path: '/v1/customers', local: true }, // 50 — MUT-286: the client picker's Add «name», both modes
  { method: 'POST', path: '/v1/projects', local: true }, // 51 — MUT-318: the matter picker's Add «name», both modes
  { method: 'GET', path: '/v1/summaries/expenses', local: true }, // defined in client.ts, unused by any screen yet (brief §3's "– , free" row)
  { method: 'GET', path: '/v1/summaries/activity', local: true }, // 56 — MUT-175: Reports, both modes
];

function servedPaths(): ReadonlySet<string> {
  const deps: PortalRouteDependencies = {
    store: new MemoryLedgerStore(),
    attachments: { storage: null, urlTtlSeconds: 900 },
    fxRates: null,
    terms: null,
    billing: false,
    receiptsLibrary: false,
  };
  const served = new Set<string>();
  for (const factory of PORTAL_ROUTES) {
    for (const handler of factory(deps).routes) served.add(`${handler.method} ${handler.path}`);
  }
  return served;
}

describe('PORTAL_ROUTES coverage (MUT-286)', () => {
  it('serves every portal client call the brief marks local', () => {
    const served = servedPaths();
    const missing = CLIENT_CALLS.filter((call) => call.local && !served.has(`${call.method} ${call.path}`));
    expect(missing).toEqual([]);
  });

  it('matches the brief §3 table plus the client and matter creates (MUT-286, MUT-318), the terms acceptance (MUT-324), the records export (MUT-325), the trial prompt (MUT-418), Reports (MUT-175) and the passkey suggestion (MUT-370): 57 calls, 11 remote-only', () => {
    expect(CLIENT_CALLS.filter((call) => call.path !== '/v1/summaries/expenses')).toHaveLength(57);
    expect(CLIENT_CALLS.filter((call) => !call.local)).toHaveLength(11);
  });

  it('never serves the signed-in records export locally (MUT-325)', () => {
    const served = servedPaths();
    expect([...served].filter((route) => route.includes('/v1/records-export'))).toEqual([]);
  });
});
