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

export async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.profileId) headers['X-Mutaba3a-Profile'] = options.profileId;

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
  me: () => request<Get<'/v1/me'>>('GET', '/v1/me'),
  signIn: (body: Schemas['SignInRequest']) => request<OkJson<'/v1/sessions', 'post'>>('POST', SIGN_IN_PATH, { body }),
  signOut: () => request<void>('DELETE', '/v1/sessions/current'),

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
  payments: (profileId: string, query: Query<'/v1/payments'> = {}) =>
    request<Get<'/v1/payments'>>('GET', '/v1/payments', { profileId, query }),
  attachments: (profileId: string, query: Query<'/v1/attachments'> = {}) =>
    request<Get<'/v1/attachments'>>('GET', '/v1/attachments', { profileId, query }),
  attachmentDownload: (profileId: string, attachmentId: string) =>
    request<Get<'/v1/attachments/{attachmentId}/download'>>(
      'GET',
      `/v1/attachments/${encodeURIComponent(attachmentId)}/download`,
      { profileId },
    ),
};
