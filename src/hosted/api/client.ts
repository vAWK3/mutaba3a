import type { components, paths } from './schema';
import type { LocalBackend } from '../session/localBackendContract';
import { currentMode, setMode } from '../session/mode';

/**
 * The portal's only door to data (hosted-portal.md §7.1): same-origin `fetch`
 * with the session cookie, typed by `schema.d.ts` (generated from the server's
 * OpenAPI document; `npm run hosted:types:check` fails on drift). The active
 * hosted profile travels as `X-Mutaba3a-Profile`; the identity routes carry none.
 *
 * Signed out (MUT-286, ADR-097), the same requests go to the local backend, the
 * server's own routes running in this page: see `goesRemote()` and `sendLocal()` below.
 */

export type Schemas = components['schemas'];
export type Me = Schemas['Me'];
/** MUT-324: Me.terms is null where no terms apply (signed out); the generated type must keep that null, or callers lose the check. */
export type MeTermsMayBeNull = AssertTrue<null extends Me['terms'] ? true : false>;
type AssertTrue<T extends true> = T;
export type HostedProfile = Schemas['HostedProfile'];
/** MUT-448: one cross-profile read for the Reports Glance (MUT-447, ADR-204). */
export type Verdict = Schemas['Verdict'];
/** MUT-115: one of the person's passkeys. */
export type Passkey = Schemas['Passkey'];
export type FirmRequestResponse = Schemas['FirmRequestResponse'];
export type RemoveProfileOwnerResponse = Schemas['RemoveProfileOwnerResponse'];
export type ProfileOwner = Schemas['ProfileOwner'];
export type MalafatSuggestions = Schemas['MalafatSuggestions'];
/** MUT-418: the person's answers to the trial's card prompt. */
export type TrialPrompt = Schemas['TrialPrompt'];
export type TrialPromptAction = Schemas['TrialPromptChange']['action'];
/** MUT-370: the "Add a passkey" suggestion, as the server decides it. */
export type PasskeyPrompt = Schemas['PasskeyPrompt'];
export type PasskeyPromptAction = Schemas['PasskeyPromptChange']['action'];
export type MalafatSuggestionsChange = Schemas['MalafatSuggestionsChange'];
export type Currency = Schemas['Currency'];
export type Customer = Schemas['Customer'];
export type CreateCustomerRequest = Schemas['CreateCustomerRequest'];
export type CreateProjectRequest = Schemas['CreateProjectRequest'];
export type Project = Schemas['Project'];
export type Receivable = Schemas['Receivable'];
export type Payment = Schemas['Payment'];
export type Allocation = Schemas['Allocation'];
export type Attachment = Schemas['Attachment'];
export type OrganizationSummary = Schemas['OrganizationSummary'];
export type CurrencySummary = Schemas['CurrencySummary'];
export type CustomerSummaryRow = Schemas['CustomerSummaryRow'];
export type CustomerSummary = Schemas['CustomerSummary'];
export type ActivitySummary = Schemas['ActivitySummary'];
export type ProjectSummary = Schemas['ProjectSummary'];
export type ItemStatus = Schemas['ItemStatus'];
export type CustomerSummaryStatus = Schemas['CustomerSummaryStatus'];
export type Expense = Schemas['Expense'];
export type ExpenseDetail = Schemas['ExpenseDetail'];
export type ExpenseCategory = Schemas['ExpenseCategory'];
export type VendorSuggestion = Schemas['VendorSuggestion'];
export type ExpenseReceipt = Schemas['ExpenseReceipt'];
export type ExpenseSummary = Schemas['ExpenseSummary'];
export type CreateExpenseRequest = Schemas['CreateExpenseRequest'];
export type UpdateExpenseRequest = Schemas['UpdateExpenseRequest'];
export type CreateReceiptUploadRequest = Schemas['CreateReceiptUploadRequest'];
export type CreateReceiptUploadResponse = Schemas['CreateReceiptUploadResponse'];
/** MUT-260: the receipts library (MUT-255's /v1/receipts). */
export type ReceiptListItem = Schemas['ReceiptListItem'];
export type ReceiptCounts = Schemas['ReceiptCounts'];
export type ReceiptFilingStatus = Schemas['ReceiptFilingStatus'];
export type ReceiptDisposition = 'attachment' | 'inline';
export type ApproveReceiptRequest = Schemas['ApproveReceiptRequest'];
export type ApproveReceiptResponse = Schemas['ApproveReceiptResponse'];
export type CreateLibraryReceiptUploadRequest = Schemas['CreateLibraryReceiptUploadRequest'];
export type Conversion = Schemas['Conversion'];
export type CreateConversionRequest = Schemas['CreateConversionRequest'];
export type UpdateConversionRequest = Schemas['UpdateConversionRequest'];
export type ExpenseGroup = Schemas['ExpenseGroup'];
export type ExpenseGroupDetail = Schemas['ExpenseGroupDetail'];
export type ExpenseGroupSummary = Schemas['ExpenseGroupSummary'];
export type CreateExpenseGroupRequest = Schemas['CreateExpenseGroupRequest'];
export type UpdateExpenseGroupRequest = Schemas['UpdateExpenseGroupRequest'];
export type ExpenseGroupMark = Schemas['ExpenseGroupOverrideMode'];
export type FxRatesResponse = Schemas['FxRatesResponse'];
export type CreateIncomeRequest = Schemas['CreateIncomeRequest'];
export type IncomeResponse = Schemas['IncomeResponse'];
export type PaymentMethod = Schemas['PaymentMethod'];
export type SettleReceivableRequest = Schemas['SettleReceivableRequest'];
export type ReversePaymentRequest = Schemas['ReversePaymentRequest'];
export type CreditRequest = Schemas['CreditRequest'];
export type CreditResponse = Schemas['CreditResponse'];
export type Credit = Schemas['Credit'];
export type CreditsResponse = Schemas['CreditsResponse'];
export type UpdateIncomeRequest = Schemas['UpdateIncomeRequest'];
export type UpdatePaymentRequest = Schemas['UpdatePaymentRequest'];
export type SettleReceivableResponse = Schemas['SettleReceivableResponse'];
export type ProfileType = Schemas['ProfileType'];
export type CreateProfileRequest = Schemas['CreateProfileRequest'];
export type UpdateProfileRequest = Schemas['UpdateProfileRequest'];
export type UpdateProfileResponse = Schemas['UpdateProfileResponse'];
export type ProfileTypeChange = Schemas['ProfileTypeChange'];
export type SetupLinkCheck = Schemas['SetupLinkCheckResponse'];
/** MUT-368: which self-service doors the server opens. */
export type SelfServiceDoors = Schemas['SelfServiceDoors'];
export type SignupRequest = Schemas['SignupRequest'];
export type AccountRecoveryRequest = Schemas['AccountRecoveryRequest'];
/** MUT-368: the redeem's answer; `status` PENDING_REVIEW is a signup waiting for the operator (MUT-367). */
export type SetupLinkRedeemed = Schemas['SetupLinkRedeemResponse'];
export type BillingOverview = Schemas['BillingOverview'];
export type CheckoutSessionRequest = Schemas['CheckoutSessionRequest'];
export type BillingRedirect = Schemas['BillingRedirect'];
export type BillingEntitlement = Schemas['BillingEntitlement'];
/** Why a setup link can't be used (MUT-235): the check's non-valid states, and `details.state` on a 410. */
export type SetupLinkRefusal = Exclude<SetupLinkCheck['state'], 'valid'>;

type ServerErrorCode = Schemas['ErrorEnvelope']['error']['code'];
/**
 * Signed out (MUT-286), the local backend's own failures, never dressed up as NETWORK:
 * - `LOCAL_FORMAT_TOO_NEW`: another tab saved this device's records with a newer build; reload (D1);
 * - `LOCAL_SAVE_FAILED`: the browser refused a save (storage full); this page stops until a reload;
 * - `LOCAL_UNAVAILABLE`: the local backend can't run here (storage blocked, private browsing).
 */
export type LocalStopCode = 'LOCAL_FORMAT_TOO_NEW' | 'LOCAL_SAVE_FAILED';
export type ApiErrorCode = ServerErrorCode | 'NETWORK' | 'UNKNOWN' | LocalStopCode | 'LOCAL_UNAVAILABLE';

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

/**
 * Which request fields a 422 VALIDATION_FAILED names (MUT-368, review P1-2): the validator's issues (`details` is
 * their list, each with a `path`) or a route's own `details.fields`. Empty when it names none.
 */
export function apiErrorFields(error: ApiError): string[] {
  const details = error.details as unknown;
  if (Array.isArray(details)) {
    return details.flatMap((issue) => {
      const head = (issue as { path?: unknown } | null)?.path;
      return Array.isArray(head) && typeof head[0] === 'string' ? [head[0]] : [];
    });
  }
  const fields = (details as { fields?: unknown } | null)?.fields;
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string') : [];
}

/**
 * MUT-227: which end of a date range a DATE_INVALID crossed. 'past' is the server's ten-year floor; undefined from
 * an older server or a malformed date.
 */
export function apiErrorBound(error: ApiError): 'past' | 'future' | undefined {
  const bound = (error.details as { bound?: unknown } | null)?.bound;
  return bound === 'past' || bound === 'future' ? bound : undefined;
}

const SECONDS_PER_MINUTE = 60;

/** A 429's wait in whole minutes, at least one, for "try again in N minutes" (sign-in and setup pages). */
export function retryMinutes(error: ApiError): number {
  return Math.max(1, Math.ceil((error.retryAfterSeconds ?? SECONDS_PER_MINUTE) / SECONDS_PER_MINUTE));
}

/**
 * MUT-464: the language the portal shows, sent as `Accept-Language` on every call so the server names seeded expense
 * categories in it (local mode too: the local backend runs the same routes). Set by HostedLanguageProvider.
 */
let requestLanguage: 'en' | 'ar' | null = null;

export function setRequestLanguage(language: 'en' | 'ar' | null): void {
  requestLanguage = language;
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

/**
 * MUT-262 (D3): a password change rotates the session cookie, so a request sent with the old cookie can come back 401
 * after the change committed. Each request remembers the credential generation it was sent under; a successful change
 * bumps it. A 401 waits for any change in flight to settle and ends the session only if its generation is still current.
 * The phone follows the same rule (MUT-208).
 */
let credentialGeneration = 0;
let credentialChange: Promise<void> | null = null;

async function rotatingCredential<T>(call: () => Promise<T>): Promise<T> {
  const change = call();
  const settled = change.then(
    () => {
      credentialGeneration += 1;
    },
    () => undefined,
  );
  credentialChange = settled;
  try {
    return await change;
  } finally {
    await settled;
    if (credentialChange === settled) credentialChange = null;
  }
}

async function reportUnauthorised(error: ApiError, sentUnder: number, waitForChange: boolean): Promise<void> {
  if (waitForChange && credentialChange) await credentialChange;
  if (sentUnder === credentialGeneration) unauthorisedHandler?.(error);
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
/** MUT-115: passkey sign-in; like the password sign-in, its 401 is a refused credential, never an ended session. */
const PASSKEY_SIGN_IN_PATH = '/v1/sessions/passkey';
const SIGN_IN_PATHS: ReadonlySet<string> = new Set([SIGN_IN_PATH, PASSKEY_SIGN_IN_PATH]);
const CHANGE_PASSWORD_PATH = '/v1/me/password';
/**
 * Signing in and redeeming a setup link always talk to the server, whatever the mode (brief §2.6). So do the
 * self-service doors, signup and recovery (MUT-368): the in-page backend has no mailer to send their links. And the
 * passkey sign-in challenge (MUT-115), asked for while signed out.
 */
// MUT-434: connecting an agent (/v1/oauth) is the server's alone: the agent talks to the hosted service, never this page.
const ALWAYS_REMOTE = /^\/v1\/(sessions|account-setup|self-service|signups|account-recovery|passkey-challenges|oauth)(\/|\?|$)/;
/** The local backend's errors that stop the page, by class name: the classes live in the lazy chunk (transport.ts). */
const LOCAL_STOPS: Readonly<Record<string, LocalStopCode>> = {
  LocalFormatTooNewError: 'LOCAL_FORMAT_TOO_NEW',
  // MUT-287 review D12: a newer build upgraded a local database under this page (src/hosted/local/idb.ts); same screen.
  LocalDatabaseSupersededError: 'LOCAL_FORMAT_TOO_NEW',
  LocalSaveFailedError: 'LOCAL_SAVE_FAILED',
};

type LocalStopHandler = (code: LocalStopCode) => void;
let localStopHandler: LocalStopHandler | null = null;

/** Registers the one place a stopped local backend is shown (SessionBridge); returns the unregister function. */
export function setLocalStopHandler(handler: LocalStopHandler): () => void {
  localStopHandler = handler;
  return () => {
    if (localStopHandler === handler) localStopHandler = null;
  };
}

/** What a thrown local-backend error means to the portal. */
function localFailure(cause: unknown): ApiError {
  const code = cause instanceof Error ? LOCAL_STOPS[cause.name] : undefined;
  if (code) {
    localStopHandler?.(code);
    return new ApiError(0, code, cause instanceof Error ? cause.message : code);
  }
  return new ApiError(0, 'LOCAL_UNAVAILABLE', 'The records on this device could not be opened');
}

let localBackendPromise: Promise<LocalBackend> | null = null;

/** The lazy local chunk (brief §2.7): imported on the first signed-out request, never by a signed-in page. */
export function localBackend(): Promise<LocalBackend> {
  localBackendPromise ??= import('@mut/local-backend')
    .then((module) => module.bootLocalBackend())
    .catch((error: unknown) => {
      localBackendPromise = null;
      throw error;
    });
  return localBackendPromise;
}

/** MUT-291: this origin's signed-out records, counted from disk without booting a session (the old address's /carry-over). */
export async function localRecordCount(): Promise<number> {
  return (await import('@mut/local-backend')).countRecordsOnThisDevice();
}

let unhintedProbe: Promise<boolean> | null = null;

/**
 * No mode hint (first visit, or a session from before local mode): ask the
 * server once whether this browser is signed in. Only a 200 or a 401 is an
 * answer, and only an answer is saved; anything else uses the server for this
 * request and asks again next time, so an outage never sends a signed-in
 * person to an empty local app. Resolves true when the server should answer.
 */
function probeRemote(): Promise<boolean> {
  unhintedProbe ??= fetch('/v1/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((response) => {
      // Only the request in flight is shared; once answered, the saved hint is the answer.
      unhintedProbe = null;
      if (response.status === 200) setMode('remote');
      else if (response.status === 401) setMode('local');
      return response.status !== 401;
    })
    .catch((error: unknown) => {
      unhintedProbe = null;
      throw error;
    });
  return unhintedProbe;
}

/**
 * Whether a request goes to the server (cookie) or to the local backend (this page), by mode. Decided at once
 * whenever the mode is known, so a request starts in the same tick it always did; a promise only during the
 * first-visit check, which rejects when that check can't reach the server.
 */
function goesRemote(url: string): boolean | Promise<boolean> {
  const mode = currentMode();
  if (ALWAYS_REMOTE.test(url) || mode === 'remote') return true;
  return mode === 'probe' ? probeRemote() : false;
}

async function sendLocal(url: string, init: RequestInit): Promise<Response> {
  const backend = await localBackend();
  return backend.fetch(new Request(new URL(url, window.location.origin), init));
}

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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * The request, its routing and its errors, without reading the body: `request` reads it as JSON; MUT-325's export
 * reads a records file and receipt bytes as they stream. Throws `ApiError` for any non-2xx, as `request` always has.
 */
export async function send(method: Method, path: string, options: RequestOptions & { accept?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: options.accept ?? 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.profileId) headers['X-Mutaba3a-Profile'] = options.profileId;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.ifMatchVersion) headers['If-Match'] = options.ifMatchVersion;
  if (requestLanguage) headers['Accept-Language'] = requestLanguage;

  const url = withQuery(path, options.query);
  const sentUnder = credentialGeneration;
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  };
  const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';
  const unreachable = () => new ApiError(0, 'NETWORK', 'The request did not reach the server');

  const decided = goesRemote(url);
  let wentRemote: boolean;
  if (typeof decided === 'boolean') {
    wentRemote = decided;
  } else {
    try {
      wentRemote = await decided;
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      throw unreachable();
    }
  }

  let response: Response;
  try {
    response = await (wentRemote ? fetch(url, init) : sendLocal(url, init));
  } catch (cause) {
    if (isAbort(cause)) throw cause;
    throw wentRemote ? unreachable() : localFailure(cause);
  }

  if (!response.ok) {
    const error = await toApiError(response);
    const isSignIn = method === 'POST' && SIGN_IN_PATHS.has(path);
    // A local 401 is the local backend's own business (it re-mints its session); only the server's ends a session.
    // The change itself never waits on itself.
    if (error.status === 401 && !isSignIn && wentRemote) await reportUnauthorised(error, sentUnder, !(method === 'POST' && path === CHANGE_PASSWORD_PATH));
    throw error;
  }
  return response;
}

export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

type Get<P extends keyof paths> = OkJson<P, 'get'>;

/** One function per operation the portal uses (hosted-portal.md §6, §7.3). */
export const api = {
  me: (options: { signal?: AbortSignal } = {}) => request<Get<'/v1/me'>>('GET', '/v1/me', { signal: options.signal }),
  signIn: (body: Schemas['SignInRequest']) => request<OkJson<'/v1/sessions', 'post'>>('POST', SIGN_IN_PATH, { body }),
  signOut: () => request<void>('DELETE', '/v1/sessions/current'),
  /** MUT-115: the person's passkeys, oldest first, and the most they may hold. */
  listPasskeys: (signal?: AbortSignal) => request<Schemas['PasskeyList']>('GET', '/v1/passkeys', { signal }),
  /** MUT-115 (D4): 403 RECENT_SIGN_IN_REQUIRED past 10 minutes since sign-in unless `currentPassword` is sent. */
  passkeyCreationOptions: (currentPassword?: string) =>
    request<Schemas['PasskeyCreationChallenge']>('POST', '/v1/passkeys/creation-options', { body: currentPassword === undefined ? {} : { currentPassword } }),
  addPasskey: (body: Schemas['AddPasskeyRequest']) => request<Schemas['Passkey']>('POST', '/v1/passkeys', { body }),
  renamePasskey: (id: string, name: string) => request<Schemas['Passkey']>('PATCH', `/v1/passkeys/${encodeURIComponent(id)}`, { body: { name } }),
  /** MUT-115 (A2): also signs out every other session this passkey opened. */
  removePasskey: (id: string) => request<void>('DELETE', `/v1/passkeys/${encodeURIComponent(id)}`),
  /** MUT-370: Not now on the passkey suggestion (hidden 30 days; the third retires it). */
  changePasskeyPrompt: (action: PasskeyPromptAction) => request<PasskeyPrompt>('PATCH', '/v1/me/passkey-prompt', { body: { action } }),
  /** MUT-434: the agent asking to connect, for the consent page (404 once answered or expired). */
  oauthRequest: (requestId: string, signal?: AbortSignal) => request<Schemas['OAuthAuthorizationRequest']>('GET', `/v1/oauth/requests/${encodeURIComponent(requestId)}`, { signal }),
  /** MUT-434: allow or deny; either way the answer is where to send the browser (409 when already answered). */
  decideOauthRequest: (requestId: string, decision: Schemas['OAuthDecisionRequest']['decision']) =>
    request<Schemas['OAuthDecision']>('POST', `/v1/oauth/requests/${encodeURIComponent(requestId)}/decision`, { body: { decision } }),
  /** MUT-434: connected agents and the MCP address (403 FEATURE_NOT_ENABLED without agent_access). */
  listOauthGrants: (signal?: AbortSignal) => request<Schemas['OAuthGrantList']>('GET', '/v1/oauth/grants', { signal }),
  /** MUT-434: the agent loses access on its next call. */
  revokeOauthGrant: (grantId: string) => request<void>('DELETE', `/v1/oauth/grants/${encodeURIComponent(grantId)}`),
  /** MUT-115: a single-use sign-in challenge (public). */
  passkeyChallenge: (signal?: AbortSignal) => request<Schemas['PasskeySignInChallenge']>('POST', '/v1/passkey-challenges', { signal }),
  signInWithPasskey: (body: Schemas['PasskeySignInRequest']) => request<OkJson<'/v1/sessions/passkey', 'post'>>('POST', PASSKEY_SIGN_IN_PATH, { body }),
  /** MUT-237: revokes every other session, web and device; this one stays signed in under a new cookie (MUT-262). */
  changePassword: (body: Schemas['ChangePasswordRequest']) => rotatingCredential(() => request<void>('POST', CHANGE_PASSWORD_PATH, { body })),
  /** MUT-333: starts 30 days of grace; every other session is signed out, this one sees only the closing page. */
  closeAccount: (body: Schemas['CloseAccountRequest']) => request<Schemas['CloseAccountResponse']>('POST', '/v1/me/closure', { body }),
  /** MUT-333: Keep my account, within the grace. Idempotent. */
  keepAccount: () => request<Schemas['KeepAccountResponse']>('DELETE', '/v1/me/closure'),
  /** MUT-235/236: the setup-link token travels in the body only, never in a URL. */
  checkSetupLink: (token: string, signal?: AbortSignal) =>
    request<SetupLinkCheck>('POST', '/v1/account-setup/check', { body: { token }, signal }),
  redeemSetupLink: (body: Schemas['SetupLinkRedeemRequest'], signal?: AbortSignal) =>
    request<SetupLinkRedeemed>('POST', '/v1/account-setup', { body, signal }),
  /** MUT-368: which self-service doors this server opens (public; says nothing about any account). */
  selfService: (signal?: AbortSignal) => request<SelfServiceDoors>('GET', '/v1/self-service', { signal }),
  /** MUT-366/368: always 202 {status:"sent"} for an address, whatever exists; 404 while signup is closed. */
  signup: (body: SignupRequest, signal?: AbortSignal) => request<Schemas['SelfServiceAccepted']>('POST', '/v1/signups', { body, signal }),
  /** MUT-366/368: always 202 {status:"sent"}; mails a link only to an account that can use one. */
  recoverAccount: (body: AccountRecoveryRequest, signal?: AbortSignal) =>
    request<Schemas['SelfServiceAccepted']>('POST', '/v1/account-recovery', { body, signal }),
  /** MUT-191: off replaces; dismissals are added to what the account holds. */
  changeMalafatSuggestions: (body: MalafatSuggestionsChange) => request<MalafatSuggestions>('PATCH', '/v1/me/malafat-suggestions', { body }),
  /** MUT-418: answer the first-run trial step, or hide the Home trial banner for 3 days. */
  changeTrialPrompt: (action: TrialPromptAction) => request<TrialPrompt>('PATCH', '/v1/me/trial-prompt', { body: { action } }),
  /** MUT-324: the signed-in person accepts the current terms, read in `locale`. Idempotent per version. */
  acceptTerms: (body: Schemas['TermsAcceptanceRequest']) => request<Schemas['TermsStatus']>('POST', '/v1/me/terms-acceptance', { body }),
  /** MUT-362: Settings › Billing. Person-level: no profile header; signed in only. */
  billing: (options: { signal?: AbortSignal } = {}) => request<BillingOverview>('GET', '/v1/billing', { signal: options.signal }),
  startCheckout: (body: CheckoutSessionRequest) => request<BillingRedirect>('POST', '/v1/billing/checkout-session', { body }),
  openBillingPortal: (body: Schemas['PortalSessionRequest']) => request<BillingRedirect>('POST', '/v1/billing/portal-session', { body }),

  organizationSummary: (profileId: string, query: Query<'/v1/summaries/organization'> = {}) =>
    request<Get<'/v1/summaries/organization'>>('GET', '/v1/summaries/organization', { profileId, query }),
  customerSummary: (profileId: string, customerId: string) =>
    request<Get<'/v1/summaries/customers/{customerId}'>>('GET', `/v1/summaries/customers/${encodeURIComponent(customerId)}`, { profileId }),
  customers: (profileId: string, query: Query<'/v1/customers'> = {}) =>
    request<Get<'/v1/customers'>>('GET', '/v1/customers', { profileId, query }),
  /** MUT-286: the client picker's Add «name», on a profile the person owns (session `customers:write`, MUT-65). */
  createCustomer: (profileId: string, body: CreateCustomerRequest, idempotencyKey: string) =>
    request<Customer>('POST', '/v1/customers', { profileId, body, idempotencyKey }),
  customer: (profileId: string, customerId: string) =>
    request<Get<'/v1/customers/{customerId}'>>('GET', `/v1/customers/${encodeURIComponent(customerId)}`, { profileId }),
  projects: (profileId: string, query: Query<'/v1/projects'> = {}) =>
    request<Get<'/v1/projects'>>('GET', '/v1/projects', { profileId, query }),
  /** MUT-318: the matter picker's Add «name», on a profile the person owns (session `projects:write`, MUT-65). */
  createProject: (profileId: string, body: CreateProjectRequest, idempotencyKey: string) =>
    request<Project>('POST', '/v1/projects', { profileId, body, idempotencyKey }),
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
  expenses: (profileId: string, query: Query<'/v1/expenses'> = {}, signal?: AbortSignal) =>
    request<Get<'/v1/expenses'>>('GET', '/v1/expenses', { profileId, query, signal }),
  expense: (profileId: string, expenseId: string) =>
    request<Get<'/v1/expenses/{expenseId}'>>('GET', `/v1/expenses/${encodeURIComponent(expenseId)}`, { profileId }),
  createExpense: (profileId: string, body: CreateExpenseRequest, idempotencyKey: string) =>
    request<Expense>('POST', '/v1/expenses', { profileId, body, idempotencyKey }),
  updateExpense: (profileId: string, expenseId: string, body: UpdateExpenseRequest, version: string) =>
    request<Expense>('PATCH', `/v1/expenses/${encodeURIComponent(expenseId)}`, { profileId, body, ifMatchVersion: version }),
  deleteExpense: (profileId: string, expenseId: string) =>
    request<void>('DELETE', `/v1/expenses/${encodeURIComponent(expenseId)}`, { profileId }),

  // MUT-175: Reports names archived categories too (`includeArchived: 'true'`)
  expenseCategories: (profileId: string, query: Query<'/v1/expense-categories'> = {}) =>
    request<Get<'/v1/expense-categories'>>('GET', '/v1/expense-categories', { profileId, query }),

  // MUT-254: the vendor typeahead (suggestions only; saving an expense links its vendor on the server).
  vendors: (profileId: string, query: Query<'/v1/vendors'>) =>
    request<Get<'/v1/vendors'>>('GET', '/v1/vendors', { profileId, query }),

  expenseSummary: (profileId: string, query: Query<'/v1/summaries/expenses'>) =>
    request<Get<'/v1/summaries/expenses'>>('GET', '/v1/summaries/expenses', { profileId, query }),

  // MUT-175: Reports — what came in and went out over a period, with a 12-month history.
  activitySummary: (profileId: string, query: Query<'/v1/summaries/activity'>) =>
    request<Get<'/v1/summaries/activity'>>('GET', '/v1/summaries/activity', { profileId, query }),

  // MUT-448: the Reports Glance's one read across the person's profiles (MUT-447): no X-Mutaba3a-Profile. With no
  // from/to the server picks this month in the base profile's timezone (eng D4).
  verdict: (query: Query<'/v1/summaries/verdict'> = {}) => request<Get<'/v1/summaries/verdict'>>('GET', '/v1/summaries/verdict', { query }),

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

  // The receipts library (MUT-260 over MUT-255's routes): session-only, hosted only (404 signed out or with the
  // library off, which is how the portal learns it is off, D4). Upload start and approve carry Idempotency-Keys.
  listReceipts: (profileId: string, query: Query<'/v1/receipts'> = {}) =>
    request<Get<'/v1/receipts'>>('GET', '/v1/receipts', { profileId, query }),
  receiptCounts: (profileId: string) => request<ReceiptCounts>('GET', '/v1/receipts/counts', { profileId }),
  getReceipt: (profileId: string, receiptId: string) =>
    request<ExpenseReceipt>('GET', `/v1/receipts/${encodeURIComponent(receiptId)}`, { profileId }),
  libraryReceiptDownload: (profileId: string, receiptId: string, disposition: ReceiptDisposition = 'attachment') =>
    request<Get<'/v1/receipts/{receiptId}/download'>>('GET', `/v1/receipts/${encodeURIComponent(receiptId)}/download`, {
      profileId,
      query: disposition === 'inline' ? { disposition } : {},
    }),
  startLibraryUpload: (profileId: string, body: CreateLibraryReceiptUploadRequest, idempotencyKey: string) =>
    request<CreateReceiptUploadResponse>('POST', '/v1/receipts/uploads', { profileId, body, idempotencyKey }),
  completeLibraryReceipt: (profileId: string, receiptId: string) =>
    request<ExpenseReceipt>('POST', `/v1/receipts/${encodeURIComponent(receiptId)}/complete`, { profileId }),
  /** A4: the best-effort cleanup after a failed PUT or complete, so a PENDING row doesn't hold the pending cap. */
  deleteLibraryReceipt: (profileId: string, receiptId: string) =>
    request<void>('DELETE', `/v1/receipts/${encodeURIComponent(receiptId)}`, { profileId }),
  approveReceipt: (profileId: string, receiptId: string, body: ApproveReceiptRequest, idempotencyKey: string) =>
    request<ApproveReceiptResponse>('POST', `/v1/receipts/${encodeURIComponent(receiptId)}/approve`, { profileId, body, idempotencyKey }),

  // Income (MUT-133) — personal profiles only (data/incomeAffordances.ts). Both writes carry an
  // attempt-scoped Idempotency-Key (data/attemptKey.ts), never one minted per click.
  createIncome: (profileId: string, body: CreateIncomeRequest, idempotencyKey: string) =>
    request<IncomeResponse>('POST', '/v1/income', { profileId, body, idempotencyKey }),
  settleReceivable: (profileId: string, receivableId: string, body: SettleReceivableRequest, idempotencyKey: string) =>
    request<SettleReceivableResponse>('POST', `/v1/receivables/${encodeURIComponent(receivableId)}/settle`, { profileId, body, idempotencyKey }),
  // MUT-453: correcting money a person recorded. Both carry the attempt's Idempotency-Key.
  reversePayment: (profileId: string, paymentId: string, body: ReversePaymentRequest, idempotencyKey: string) =>
    request<Payment>('POST', `/v1/payments/${encodeURIComponent(paymentId)}/reverse`, { profileId, body, idempotencyKey }),
  creditReceivable: (profileId: string, receivableId: string, body: CreditRequest, idempotencyKey: string) =>
    request<CreditResponse>('POST', `/v1/receivables/${encodeURIComponent(receivableId)}/credits`, { profileId, body, idempotencyKey }),
  receivableCredits: (profileId: string, receivableId: string) =>
    request<CreditsResponse>('GET', `/v1/receivables/${encodeURIComponent(receivableId)}/credits`, { profileId }),
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
  // MUT-300: the owner asks for firm features; idempotent on the server, attempt-scoped key like create.
  requestFirm: (profileId: string, idempotencyKey: string) =>
    request<FirmRequestResponse>('POST', `/v1/profiles/${encodeURIComponent(profileId)}/firm-request`, { idempotencyKey }),
  // MUT-373: yourself to leave a profile you co-own, a co-owner to remove them (the creator only); attempt-scoped key.
  removeProfileOwner: (profileId: string, userId: string, idempotencyKey: string) =>
    request<RemoveProfileOwnerResponse>('DELETE', `/v1/profiles/${encodeURIComponent(profileId)}/owners/${encodeURIComponent(userId)}`, { idempotencyKey }),

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

  // Expense groups (MUT-267/268): session-only, under the expenses scopes. Marks are idempotent PUT/DELETE with no
  // If-Match (last write wins, MUT-267 D6), so the portal orders them per expense itself (eng review R3).
  expenseGroups: (profileId: string, query: Query<'/v1/expense-groups'> = {}) =>
    request<Get<'/v1/expense-groups'>>('GET', '/v1/expense-groups', { profileId, query }),
  expenseGroup: (profileId: string, groupId: string) =>
    request<ExpenseGroupDetail>('GET', `/v1/expense-groups/${encodeURIComponent(groupId)}`, { profileId }),
  createExpenseGroup: (profileId: string, body: CreateExpenseGroupRequest, idempotencyKey: string) =>
    request<ExpenseGroup>('POST', '/v1/expense-groups', { profileId, body, idempotencyKey }),
  updateExpenseGroup: (profileId: string, groupId: string, body: UpdateExpenseGroupRequest, version: number) =>
    request<ExpenseGroup>('PATCH', `/v1/expense-groups/${encodeURIComponent(groupId)}`, { profileId, body, ifMatchVersion: String(version) }),
  deleteExpenseGroup: (profileId: string, groupId: string) =>
    request<void>('DELETE', `/v1/expense-groups/${encodeURIComponent(groupId)}`, { profileId }),
  expenseGroupSummary: (profileId: string, groupId: string) =>
    request<ExpenseGroupSummary>('GET', `/v1/expense-groups/${encodeURIComponent(groupId)}/summary`, { profileId }),
  /** `mode` null clears the mark (DELETE). */
  setExpenseGroupMark: (profileId: string, groupId: string, expenseId: string, mode: ExpenseGroupMark | null) =>
    request<unknown>(mode ? 'PUT' : 'DELETE', `/v1/expense-groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`, {
      profileId,
      body: mode ? { mode } : undefined,
    }),

  /** Display-only reference rates (MUT-228, ADR-087); no profile header. */
  fxRates: (base: Currency) => request<FxRatesResponse>('GET', '/v1/fx-rates', { query: { base } }),
};
