import type { components, paths } from './schema';

/**
 * The portal's only door to data (hosted-portal.md §7.1): same-origin `fetch`
 * with the session cookie, typed by `schema.d.ts` (generated from the server's
 * OpenAPI document; `npm run hosted:types:check` fails on drift). The active
 * hosted profile travels as `X-Mutaba3a-Profile`; the identity routes carry none.
 */

export type Schemas = components['schemas'];
export type Me = Schemas['Me'];
export type HostedProfile = Schemas['HostedProfile'];
export type MalafatSuggestions = Schemas['MalafatSuggestions'];
export type MalafatSuggestionsChange = Schemas['MalafatSuggestionsChange'];
export type Currency = Schemas['Currency'];
export type Customer = Schemas['Customer'];
export type Project = Schemas['Project'];
export type Receivable = Schemas['Receivable'];
export type Payment = Schemas['Payment'];
export type Allocation = Schemas['Allocation'];
export type Attachment = Schemas['Attachment'];
export type OrganizationSummary = Schemas['OrganizationSummary'];
export type CurrencySummary = Schemas['CurrencySummary'];
export type CustomerSummaryRow = Schemas['CustomerSummaryRow'];
export type CustomerSummary = Schemas['CustomerSummary'];
export type ProjectSummary = Schemas['ProjectSummary'];
export type ItemStatus = Schemas['ItemStatus'];
export type CustomerSummaryStatus = Schemas['CustomerSummaryStatus'];
export type Expense = Schemas['Expense'];
export type ExpenseDetail = Schemas['ExpenseDetail'];
export type ExpenseCategory = Schemas['ExpenseCategory'];
export type ExpenseReceipt = Schemas['ExpenseReceipt'];
export type ExpenseSummary = Schemas['ExpenseSummary'];
export type CreateExpenseRequest = Schemas['CreateExpenseRequest'];
export type UpdateExpenseRequest = Schemas['UpdateExpenseRequest'];
export type CreateReceiptUploadRequest = Schemas['CreateReceiptUploadRequest'];
export type CreateReceiptUploadResponse = Schemas['CreateReceiptUploadResponse'];
export type Conversion = Schemas['Conversion'];
export type CreateConversionRequest = Schemas['CreateConversionRequest'];
export type UpdateConversionRequest = Schemas['UpdateConversionRequest'];
export type CreateIncomeRequest = Schemas['CreateIncomeRequest'];
export type IncomeResponse = Schemas['IncomeResponse'];
export type PaymentMethod = Schemas['PaymentMethod'];
export type SettleReceivableRequest = Schemas['SettleReceivableRequest'];
export type UpdateIncomeRequest = Schemas['UpdateIncomeRequest'];
export type UpdatePaymentRequest = Schemas['UpdatePaymentRequest'];
export type SettleReceivableResponse = Schemas['SettleReceivableResponse'];
export type ProfileType = Schemas['ProfileType'];
export type CreateProfileRequest = Schemas['CreateProfileRequest'];
export type UpdateProfileRequest = Schemas['UpdateProfileRequest'];
export type UpdateProfileResponse = Schemas['UpdateProfileResponse'];
export type ProfileTypeChange = Schemas['ProfileTypeChange'];

type ServerErrorCode = Schemas['ErrorEnvelope']['error']['code'];
export type ApiErrorCode = ServerErrorCode | 'NETWORK' | 'UNKNOWN';

type Query<P extends keyof paths> = paths[P] extends { get: { parameters: { query?: infer Q } } } ? NonNullable<Q> : never;
type OkJson<P extends keyof paths, M extends 'get' | 'post'> = paths[P][M] extends {
  responses: { [S in 200 | 201]?: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details: unknown = null,
    requestId: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Why the server refused: `details.reason` on a 409 CONFLICT or 422
 * VALIDATION_FAILED, which carry the specific reason there, not in `code`.
 * One reader for every error mapper (MUT-183 R3, TD-125).
 */
export function apiErrorReason(error: ApiError): string | undefined {
  const details = error.details as { reason?: unknown } | null;
  return typeof details?.reason === 'string' ? details.reason : undefined;
}

type UnauthorisedHandler = (error: ApiError) => void;
let unauthorisedHandler: UnauthorisedHandler | null = null;

/** Registers the one place a 401 is handled (the session layer); returns the unregister function. */
export function setUnauthorisedHandler(handler: UnauthorisedHandler): () => void {
  unauthorisedHandler = handler;
  return () => {
    if (unauthorisedHandler === handler) unauthorisedHandler = null;
  };
}

type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  profileId?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Client-generated key for a write that must not replay (MUT-42 §14.2). Omitted for receipt-upload starts, which are idempotent by nature — a repeat leaves an unlisted PENDING row. */
  idempotencyKey?: string;
  /** The `version` read before an optimistic PATCH; sent as `If-Match`, refused with 409 on a stale value. */
  ifMatchVersion?: string;
}

const SIGN_IN_PATH = '/v1/sessions';

function withQuery(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

function retryAfter(response: Response, details: unknown): number | null {
  const header = response.headers.get('retry-after');
  // Not an amount: Retry-After is a whole number of seconds, already checked to be digits.
  // eslint-disable-next-line no-restricted-syntax
  if (header && /^\d+$/.test(header)) return Number.parseInt(header, 10);
  const fromDetails = (details as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof fromDetails === 'number' ? fromDetails : null;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy error page, an empty body): handled below.
  }
  const error = (body as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown } } | null)?.error;
  if (!error || typeof error.code !== 'string') {
    return new ApiError(response.status, 'UNKNOWN', `HTTP ${response.status}`, null, null, retryAfter(response, null));
  }
  return new ApiError(
    response.status,
    error.code as ServerErrorCode,
    typeof error.message === 'string' ? error.message : error.code,
    error.details ?? null,
    typeof error.requestId === 'string' ? error.requestId : null,
    retryAfter(response, error.details),
  );
}

export async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.profileId) headers['X-Mutaba3a-Profile'] = options.profileId;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.ifMatchVersion) headers['If-Match'] = options.ifMatchVersion;

  let response: Response;
  try {
    response = await fetch(withQuery(path, options.query), {
      method,
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK', 'The request did not reach the server');
  }

  if (!response.ok) {
    const error = await toApiError(response);
    const isSignIn = method === 'POST' && path === SIGN_IN_PATH;
    if (error.status === 401 && !isSignIn) unauthorisedHandler?.(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

type Get<P extends keyof paths> = OkJson<P, 'get'>;

/** One function per operation the portal uses (hosted-portal.md §6, §7.3). */
export const api = {
  me: (options: { signal?: AbortSignal } = {}) => request<Get<'/v1/me'>>('GET', '/v1/me', { signal: options.signal }),
  signIn: (body: Schemas['SignInRequest']) => request<OkJson<'/v1/sessions', 'post'>>('POST', SIGN_IN_PATH, { body }),
  signOut: () => request<void>('DELETE', '/v1/sessions/current'),
  /** MUT-191: off replaces; dismissals are added to what the account holds. */
  changeMalafatSuggestions: (body: MalafatSuggestionsChange) => request<MalafatSuggestions>('PATCH', '/v1/me/malafat-suggestions', { body }),

  organizationSummary: (profileId: string, query: Query<'/v1/summaries/organization'> = {}) =>
    request<Get<'/v1/summaries/organization'>>('GET', '/v1/summaries/organization', { profileId, query }),
  customerSummary: (profileId: string, customerId: string) =>
    request<Get<'/v1/summaries/customers/{customerId}'>>('GET', `/v1/summaries/customers/${encodeURIComponent(customerId)}`, { profileId }),
  customers: (profileId: string, query: Query<'/v1/customers'> = {}) =>
    request<Get<'/v1/customers'>>('GET', '/v1/customers', { profileId, query }),
  customer: (profileId: string, customerId: string) =>
    request<Get<'/v1/customers/{customerId}'>>('GET', `/v1/customers/${encodeURIComponent(customerId)}`, { profileId }),
  projects: (profileId: string, query: Query<'/v1/projects'> = {}) =>
    request<Get<'/v1/projects'>>('GET', '/v1/projects', { profileId, query }),
  receivables: (profileId: string, query: Query<'/v1/receivables'> = {}) =>
    request<Get<'/v1/receivables'>>('GET', '/v1/receivables', { profileId, query }),
  receivable: (profileId: string, receivableId: string) =>
    request<Get<'/v1/receivables/{receivableId}'>>('GET', `/v1/receivables/${encodeURIComponent(receivableId)}`, { profileId }),
  payments: (profileId: string, query: Query<'/v1/payments'> = {}) =>
    request<Get<'/v1/payments'>>('GET', '/v1/payments', { profileId, query }),
  payment: (profileId: string, paymentId: string) =>
    request<Get<'/v1/payments/{paymentId}'>>('GET', `/v1/payments/${encodeURIComponent(paymentId)}`, { profileId }),
  attachments: (profileId: string, query: Query<'/v1/attachments'> = {}) =>
    request<Get<'/v1/attachments'>>('GET', '/v1/attachments', { profileId, query }),
  attachmentDownload: (profileId: string, attachmentId: string) =>
    request<Get<'/v1/attachments/{attachmentId}/download'>>(
      'GET',
      `/v1/attachments/${encodeURIComponent(attachmentId)}/download`,
      { profileId },
    ),

  // Expenses (MUT-44) — the portal's only write. See mut-44-expense-capture.md §4.
  expenses: (profileId: string, query: Query<'/v1/expenses'> = {}) =>
    request<Get<'/v1/expenses'>>('GET', '/v1/expenses', { profileId, query }),
  expense: (profileId: string, expenseId: string) =>
    request<Get<'/v1/expenses/{expenseId}'>>('GET', `/v1/expenses/${encodeURIComponent(expenseId)}`, { profileId }),
  createExpense: (profileId: string, body: CreateExpenseRequest, idempotencyKey: string) =>
    request<Expense>('POST', '/v1/expenses', { profileId, body, idempotencyKey }),
  updateExpense: (profileId: string, expenseId: string, body: UpdateExpenseRequest, version: string) =>
    request<Expense>('PATCH', `/v1/expenses/${encodeURIComponent(expenseId)}`, { profileId, body, ifMatchVersion: version }),
  deleteExpense: (profileId: string, expenseId: string) =>
    request<void>('DELETE', `/v1/expenses/${encodeURIComponent(expenseId)}`, { profileId }),

  expenseCategories: (profileId: string) =>
    request<Get<'/v1/expense-categories'>>('GET', '/v1/expense-categories', { profileId }),

  expenseSummary: (profileId: string, query: Query<'/v1/summaries/expenses'>) =>
    request<Get<'/v1/summaries/expenses'>>('GET', '/v1/summaries/expenses', { profileId, query }),

  // Receipts: start has no Idempotency-Key, like M6's attachment-upload start — a repeat
  // leaves an unlisted PENDING row rather than replaying (mut-42-hosted-expenses.md §10).
  startReceipt: (profileId: string, expenseId: string, body: CreateReceiptUploadRequest) =>
    request<CreateReceiptUploadResponse>('POST', `/v1/expenses/${encodeURIComponent(expenseId)}/receipts`, { profileId, body }),
  completeReceipt: (profileId: string, expenseId: string, receiptId: string) =>
    request<ExpenseReceipt>(
      'POST',
      `/v1/expenses/${encodeURIComponent(expenseId)}/receipts/${encodeURIComponent(receiptId)}/complete`,
      { profileId },
    ),
  deleteReceipt: (profileId: string, expenseId: string, receiptId: string) =>
    request<void>(
      'DELETE',
      `/v1/expenses/${encodeURIComponent(expenseId)}/receipts/${encodeURIComponent(receiptId)}`,
      { profileId },
    ),
  receiptDownload: (profileId: string, expenseId: string, receiptId: string) =>
    request<Get<'/v1/expenses/{expenseId}/receipts/{receiptId}/download'>>(
      'GET',
      `/v1/expenses/${encodeURIComponent(expenseId)}/receipts/${encodeURIComponent(receiptId)}/download`,
      { profileId },
    ),

  // Income (MUT-133) — personal profiles only (data/incomeAffordances.ts). Both writes carry an
  // attempt-scoped Idempotency-Key (data/attemptKey.ts), never one minted per click.
  createIncome: (profileId: string, body: CreateIncomeRequest, idempotencyKey: string) =>
    request<IncomeResponse>('POST', '/v1/income', { profileId, body, idempotencyKey }),
  settleReceivable: (profileId: string, receivableId: string, body: SettleReceivableRequest, idempotencyKey: string) =>
    request<SettleReceivableResponse>('POST', `/v1/receivables/${encodeURIComponent(receivableId)}/settle`, { profileId, body, idempotencyKey }),
  // MUT-224 (MUT-223's routes): date only, If-Match on the version the drawer loaded; no Idempotency-Key, a replay is a 409.
  redateIncome: (profileId: string, incomeId: string, body: UpdateIncomeRequest, version: string) =>
    request<IncomeResponse>('PATCH', `/v1/income/${encodeURIComponent(incomeId)}`, { profileId, body, ifMatchVersion: version }),
  redatePayment: (profileId: string, paymentId: string, body: UpdatePaymentRequest, version: string) =>
    request<Payment>('PATCH', `/v1/payments/${encodeURIComponent(paymentId)}`, { profileId, body, ifMatchVersion: version }),

  // Profiles (MUT-182/183): session routes, no X-Mutaba3a-Profile header. Create carries an
  // attempt-scoped Idempotency-Key; the PATCH sends the version read when the edit opened.
  createProfile: (body: CreateProfileRequest, idempotencyKey: string) =>
    request<HostedProfile>('POST', '/v1/profiles', { body, idempotencyKey }),
  updateProfile: (profileId: string, body: UpdateProfileRequest, version: number) =>
    request<UpdateProfileResponse>('PATCH', `/v1/profiles/${encodeURIComponent(profileId)}`, { body, ifMatchVersion: String(version) }),
  profileTypeChangePreview: (profileId: string, to: ProfileType) =>
    request<ProfileTypeChange>('GET', `/v1/profiles/${encodeURIComponent(profileId)}/type-change`, { query: { to } }),

  // Conversions (MUT-161); edit and delete since MUT-194 (ADR-075), the same shape as expenses.
  conversions: (profileId: string, query: Query<'/v1/conversions'> = {}) =>
    request<Get<'/v1/conversions'>>('GET', '/v1/conversions', { profileId, query }),
  conversion: (profileId: string, conversionId: string) =>
    request<Get<'/v1/conversions/{conversionId}'>>('GET', `/v1/conversions/${encodeURIComponent(conversionId)}`, { profileId }),
  createConversion: (profileId: string, body: CreateConversionRequest, idempotencyKey: string) =>
    request<Conversion>('POST', '/v1/conversions', { profileId, body, idempotencyKey }),
  updateConversion: (profileId: string, conversionId: string, body: UpdateConversionRequest, version: string) =>
    request<Conversion>('PATCH', `/v1/conversions/${encodeURIComponent(conversionId)}`, { profileId, body, ifMatchVersion: version }),
  deleteConversion: (profileId: string, conversionId: string) =>
    request<void>('DELETE', `/v1/conversions/${encodeURIComponent(conversionId)}`, { profileId }),
};
