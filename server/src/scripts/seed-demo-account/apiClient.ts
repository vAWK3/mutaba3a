/**
 * The `/v1/*` half of seeding a demo account (MUT-136): the same device-session
 * bearer auth a native app uses (MUT-64), not an admin token. Every mutating
 * route here is wrapped in `idempotent()` (server/src/idempotency.ts) and
 * requires an `Idempotency-Key`: a repeat call with the same key AND the same
 * body replays the original response instead of creating a duplicate, and a
 * key reused with a *different* body is rejected (422 IDEMPOTENCY_KEY_REUSED).
 * Callers must build each key so it only ever repeats when the body would
 * repeat too — see buildIdempotencyKey in seed-demo-account.ts.
 */

export class ApiClientError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status}: ${JSON.stringify(body)}`);
  }
}

export interface ApiClientDeps {
  fetch: typeof fetch;
  baseUrl: string;
}

export interface SignInResult {
  token: string;
  /** The signed-in user's own personal profile (MUT-120) — where seeded data lands. */
  organizationId: string;
}

export interface CreateCustomerBody {
  name: string;
}

export interface CreateProjectBody {
  customerId: string;
  name: string;
  currency: string;
}

export interface CreateIncomeBody {
  kind: 'received' | 'owed';
  amount: string;
  currency: string;
  occurredOn: string;
  customerId?: string;
  projectId?: string;
  title?: string;
  dueDate?: string;
  captureSource?: 'app';
}

export interface CreateExpenseBody {
  occurredOn: string;
  amount: string;
  currency: string;
  title?: string;
  vendor?: string;
  customerId?: string;
  projectId?: string;
}

export interface SettleReceivableBody {
  amount?: string;
  paidAt?: string;
}

export interface SeedApiClient {
  createCustomer(body: CreateCustomerBody, idempotencyKey: string): Promise<{ id: string }>;
  createProject(body: CreateProjectBody, idempotencyKey: string): Promise<{ id: string }>;
  createIncome(body: CreateIncomeBody, idempotencyKey: string): Promise<{ id: string }>;
  createExpense(body: CreateExpenseBody, idempotencyKey: string): Promise<{ id: string }>;
  settleReceivable(receivableId: string, body: SettleReceivableBody, idempotencyKey: string): Promise<void>;
}

export async function signIn(deps: ApiClientDeps, email: string, password: string): Promise<SignInResult> {
  const res = await request(deps, 'POST', '/v1/device-sessions', { email, password });
  const profiles = res.body.profiles as Array<{ id: string; isPersonalDefault: boolean }>;
  const personal = profiles.find((p) => p.isPersonalDefault);
  if (!personal) throw new Error(`Signed-in account at ${email} has no personal profile (expected one per MUT-120)`);
  return { token: res.body.token as string, organizationId: personal.id };
}

/**
 * MUT-235: sets a password through a setup link, the way the person would on
 * the portal. The route is same-origin only; `Sec-Fetch-Site: same-origin` is
 * what a browser on the portal sends, and wins over Origin, so it works whatever
 * PORTAL_ORIGIN the server runs with.
 */
export async function redeemSetupLink(deps: ApiClientDeps, setupLinkUrl: string, password: string): Promise<void> {
  const token = new URL(setupLinkUrl).hash.slice(1);
  await request(deps, 'POST', '/v1/account-setup', { token, password }, { 'sec-fetch-site': 'same-origin' });
}

export function clientFor(deps: ApiClientDeps, session: SignInResult): SeedApiClient {
  const authed = (method: string, path: string, body: unknown, idempotencyKey: string) =>
    request(deps, method, path, body, {
      authorization: `Bearer ${session.token}`,
      'x-mutaba3a-profile': session.organizationId,
      'idempotency-key': idempotencyKey,
    });

  return {
    createCustomer: async (body, key) => (await authed('POST', '/v1/customers', body, key)).body as { id: string },
    createProject: async (body, key) => (await authed('POST', '/v1/projects', body, key)).body as { id: string },
    createIncome: async (body, key) => (await authed('POST', '/v1/income', body, key)).body as { id: string },
    createExpense: async (body, key) => (await authed('POST', '/v1/expenses', body, key)).body as { id: string },
    settleReceivable: async (receivableId, body, key) => {
      await authed('POST', `/v1/receivables/${receivableId}/settle`, body, key);
    },
  };
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function request(deps: ApiClientDeps, method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await deps.fetch(`${deps.baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body (an HTML error page from a misconfigured URL/proxy, a plain-text
    // 502) shouldn't surface as a raw SyntaxError — the request's own method/path/status
    // is more actionable than a parse failure.
    throw new ApiClientError(method, path, res.status, { raw: text.slice(0, 200) });
  }
  if (!res.ok) throw new ApiClientError(method, path, res.status, parsed);
  return { status: res.status, body: parsed };
}
