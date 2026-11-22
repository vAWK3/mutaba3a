/**
 * MUT-571/572 (ADR-264): the Tax Authority's Open API (SHAAM), as the server uses it. OAuth 2.0 authorization code
 * (the `longtimetoken` family), then the Invoices v2 Approval service for allocation numbers and the InvoiceDecision
 * service for a held one. The port is what routes and tests see; `HttpTaxAuthorityClient` is the real one.
 *
 * Sources: the Open API guide (OpenApiUserGuide.pdf: authorize, then a token POST with Basic client credentials), the
 * Tax Authority's NodeJsExample (a refresh posts client_id and client_secret in the form; API calls carry a Bearer
 * token), and the services' OpenAPI specs (invoices_v2.json, invoicedecisionapi_v1.json).
 */

export interface TaxAuthorityTokens {
  accessToken: string;
  /** Seconds the access token lives (about 10 minutes). */
  expiresIn: number;
  /** Single-use; null when the service grants none. */
  refreshToken: string | null;
  /** When the person consented (the 90-day clock), when the answer says. */
  consentedOn: Date | null;
}

/** One line of an allocation request, in the Approval service's terms (amounts in shekels). */
export interface ApprovalItem {
  index: number;
  /** 1 goods, 2 service (3 and 4 are credits, not used here). */
  category: 1 | 2;
  description: string;
  quantity: number;
  pricePerUnit: number;
  discount: number;
  totalAmount: number;
  vatRate: number;
  vatAmount: number;
}

export interface ApprovalRequest {
  /** Who issues it (the service requires user_id or user_name). */
  userName: string;
  /** Our unique id for this request; the same id asked again returns the same answer. */
  invoiceId: string;
  /** 305 tax invoice, 320 tax invoice-receipt. */
  invoiceType: 305 | 320;
  vatNumber: number;
  invoiceReferenceNumber: string;
  customerVatNumber: number;
  customerName: string;
  invoiceDate: string;
  invoiceIssuanceDate: string;
  accountingSoftwareNumber: number;
  amountBeforeDiscount: number;
  discount: number;
  paymentAmount: number;
  vatAmount: number;
  paymentAmountIncludingVat: number;
  items: ApprovalItem[];
}

export type ApprovalAnswer =
  | { kind: 'approved'; confirmationNumber: string }
  | { kind: 'held'; message: string | null }
  | { kind: 'refused'; errors: { code: number | null; message: string | null; param: string | null }[] }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' };

export type DecisionChoice = 'CANCEL' | 'CONTINUE' | 'FURTHER_OBJECTION';

export interface TaxAuthorityClient {
  readonly environment: string;
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TaxAuthorityTokens>;
  refresh(refreshToken: string): Promise<TaxAuthorityTokens>;
  approve(accessToken: string, request: ApprovalRequest): Promise<ApprovalAnswer>;
  decide(accessToken: string, choice: DecisionChoice, request: { invoiceId: string; vatNumber: number; accountingSoftwareNumber: number }): Promise<{ ok: boolean; message: string | null }>;
}

export class TaxAuthorityError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export interface TaxAuthorityClientOptions {
  environment: string;
  /** e.g. https://openapi.taxes.gov.il/shaam/tsandbox */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/**
 * The Tax Authority holds an invoice by answering without a number; its codes for "held" are not in the published
 * spec, so the sandbox's held test dealer (777777723) is how they are learned. Until then a 400 whose only errors carry
 * these codes is read as held; anything else as refused (fix and send again).
 */
export const HELD_ERROR_CODES: ReadonlySet<number> = new Set<number>();

const DECISION_PATH: Record<DecisionChoice, string> = { CANCEL: 'Cancel', CONTINUE: 'Continue', FURTHER_OBJECTION: 'FurtherObjection' };

export class HttpTaxAuthorityClient implements TaxAuthorityClient {
  readonly environment: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: TaxAuthorityClientOptions) {
    this.environment = options.environment;
    this.fetcher = options.fetch ?? fetch;
  }

  authorizeUrl(state: string): string {
    const url = new URL(`${this.options.baseUrl}/longtimetoken/oauth2/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('scope', this.options.scope);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<TaxAuthorityTokens> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.options.redirectUri, scope: this.options.scope });
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64');
    return this.token(body, { Authorization: `Basic ${basic}` });
  }

  async refresh(refreshToken: string): Promise<TaxAuthorityTokens> {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: this.options.scope, client_id: this.options.clientId, client_secret: this.options.clientSecret });
    return this.token(body, {});
  }

  async approve(accessToken: string, request: ApprovalRequest): Promise<ApprovalAnswer> {
    let response: Response;
    try {
      response = await this.send(`${this.options.baseUrl}/Invoices/v2/Approval`, accessToken, approvalBody(request));
    } catch {
      return { kind: 'unavailable' };
    }
    if (response.status === 401 || response.status === 403) return { kind: 'unauthorized' };
    if (response.status >= 500 || response.status === 406) return { kind: 'unavailable' };
    const answer = (await response.json().catch(() => null)) as { approved?: unknown; confirmation_number?: unknown; message?: unknown } | null;
    if (response.ok && answer?.approved === true && typeof answer.confirmation_number === 'string' && answer.confirmation_number.length >= 9) {
      return { kind: 'approved', confirmationNumber: answer.confirmation_number };
    }
    const errors = errorsOf(answer?.message);
    if (errors.length > 0 && errors.every((e) => e.code !== null && HELD_ERROR_CODES.has(e.code))) return { kind: 'held', message: errors[0]?.message ?? null };
    if (errors.length === 0 && response.ok) return { kind: 'held', message: typeof answer?.message === 'string' ? answer.message : null };
    return { kind: 'refused', errors };
  }

  async decide(accessToken: string, choice: DecisionChoice, request: { invoiceId: string; vatNumber: number; accountingSoftwareNumber: number }) {
    const response = await this.send(`${this.options.baseUrl}/InvoiceDecisionApi/v1/${DECISION_PATH[choice]}`, accessToken, {
      invoice_id: request.invoiceId,
      vat_number: request.vatNumber,
      accounting_software_number: request.accountingSoftwareNumber,
    });
    const answer = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return { ok: response.ok, message: typeof answer?.message === 'string' ? answer.message : null };
  }

  private async send(url: string, accessToken: string, body: unknown): Promise<Response> {
    return this.fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
  }

  private async token(body: URLSearchParams, headers: Record<string, string>): Promise<TaxAuthorityTokens> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl}/longtimetoken/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw new TaxAuthorityError('The Tax Authority did not answer the token request', null);
    }
    // The answer is never logged or echoed: it holds the tokens.
    const answer = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; consented_on?: unknown } | null;
    if (!response.ok || typeof answer?.access_token !== 'string') throw new TaxAuthorityError('The Tax Authority refused the token request', response.status);
    const consented = typeof answer.consented_on === 'number' ? new Date(answer.consented_on * 1000) : typeof answer.consented_on === 'string' ? new Date(answer.consented_on) : null;
    return {
      accessToken: answer.access_token,
      expiresIn: typeof answer.expires_in === 'number' ? answer.expires_in : Number(answer.expires_in) || 600,
      refreshToken: typeof answer.refresh_token === 'string' ? answer.refresh_token : null,
      consentedOn: consented && !Number.isNaN(consented.getTime()) ? consented : null,
    };
  }
}

function errorsOf(message: unknown): { code: number | null; message: string | null; param: string | null }[] {
  const list = (message as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(list)) return [];
  return list.map((e: { code?: unknown; message?: unknown; param?: unknown }) => ({
    code: typeof e.code === 'number' ? e.code : null,
    message: typeof e.message === 'string' ? e.message : null,
    param: typeof e.param === 'string' ? e.param : null,
  }));
}

/** The Approval service's body: snake_case, amounts in shekels, strings cut to the service's lengths. */
export function approvalBody(r: ApprovalRequest) {
  return {
    invoice_id: r.invoiceId.slice(0, 50),
    invoice_type: r.invoiceType,
    vat_number: r.vatNumber,
    invoice_reference_number: r.invoiceReferenceNumber.slice(0, 20),
    customer_vat_number: r.customerVatNumber,
    customer_name: r.customerName.slice(0, 25),
    invoice_date: r.invoiceDate,
    invoice_issuance_date: r.invoiceIssuanceDate,
    accounting_software_number: r.accountingSoftwareNumber,
    // Error 446 (sandbox, 2026-11-22): one of user_id or user_name is required.
    user_name: r.userName.slice(0, 25),
    amount_before_discount: r.amountBeforeDiscount,
    discount: r.discount,
    payment_amount: r.paymentAmount,
    vat_amount: r.vatAmount,
    payment_amount_including_vat: r.paymentAmountIncludingVat,
    items: r.items.map((i) => ({
      index: i.index,
      category: i.category,
      description: i.description.slice(0, 30),
      quantity: i.quantity,
      price_per_unit: i.pricePerUnit,
      discount: i.discount,
      total_amount: i.totalAmount,
      vat_rate: i.vatRate,
      vat_amount: i.vatAmount,
    })),
  };
}
