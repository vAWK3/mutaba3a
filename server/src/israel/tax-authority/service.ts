import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ComposedDocument } from '../../issuing/compose.js';
import type { IssuedDocType } from '../../issuing/types.js';
import type { AllocationOutcome, LedgerStore, TaxAuthorityConnectionRecord } from '../../repositories/ports.js';
import { aboveAllocationThreshold, ALLOCATION_NUMBER_DIGITS } from '../allocation-number.js';
import type { ApprovalItem, ApprovalRequest, TaxAuthorityClient, TaxAuthorityTokens } from './client.js';
import type { TokenBox } from './token-box.js';

/**
 * MUT-571/572 (ADR-264): a profile's connection and its allocation numbers, over the injected client.
 *
 * - The connect `state` is an HMAC over (profile, person, expiry, and the portal origin the person started from): the
 *   unauthenticated callback trusts nothing else.
 * - An access token lives about 10 minutes. It is refreshed under the connection's lock, so the single-use refresh
 *   token is sent once even when two issues need a token at the same moment.
 * - The consent lasts 90 days from `consented_on`. After that the connection is expired and the owner connects again.
 */
const STATE_TTL_MS = 10 * 60_000;
export const CONSENT_DAYS = 90;
/** Refresh a little before the access token ends, so a request never leaves with one about to lapse. */
const EXPIRY_MARGIN_MS = 60_000;

export interface TaxAuthorityDeps {
  store: LedgerStore;
  client: TaxAuthorityClient;
  box: TokenBox;
  /** The key the connect `state` is signed with (derived from the session pepper). */
  stateSecret: string;
  /** The registration number of the software (the sandbox's test one until MUT-567). */
  accountingSoftwareNumber: number;
}

/** The signed connect claim. `returnOrigin`: the portal the person pressed Connect on, checked by the route before signing. */
export interface StateClaim {
  profileId: string;
  userId: string;
  returnOrigin: string | null;
}

export function signState(secret: string, payload: { profileId: string; userId: string; expiresAt: number; returnOrigin?: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', `tax-authority-state:${secret}`).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readState(secret: string, state: string, now: Date): StateClaim | null {
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', `tax-authority-state:${secret}`).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { profileId?: unknown; userId?: unknown; expiresAt?: unknown; returnOrigin?: unknown };
    if (typeof payload.profileId !== 'string' || typeof payload.userId !== 'string' || typeof payload.expiresAt !== 'number' || payload.expiresAt < now.getTime()) return null;
    return { profileId: payload.profileId, userId: payload.userId, returnOrigin: typeof payload.returnOrigin === 'string' ? payload.returnOrigin : null };
  } catch {
    return null;
  }
}

export function newState(secret: string, profileId: string, userId: string, now: Date, returnOrigin: string | null = null): string {
  return signState(secret, { profileId, userId, expiresAt: now.getTime() + STATE_TTL_MS, ...(returnOrigin ? { returnOrigin } : {}) });
}

/** The record a fresh consent (or a refresh) stores: tokens sealed, the consent's end kept from the first consent. */
export function connectionFrom(
  deps: Pick<TaxAuthorityDeps, 'box' | 'client'>,
  tokens: TaxAuthorityTokens,
  base: { organizationId: string; connectedByUserId: string; connectedAt: Date; refreshExpiresAt: Date | null },
  now: Date,
): Omit<TaxAuthorityConnectionRecord, 'version'> {
  const consentEnds = tokens.consentedOn ? new Date(tokens.consentedOn.getTime() + CONSENT_DAYS * 86_400_000) : base.refreshExpiresAt;
  return {
    organizationId: base.organizationId,
    environment: deps.client.environment,
    accessTokenSealed: deps.box.seal(tokens.accessToken),
    accessExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
    refreshTokenSealed: tokens.refreshToken ? deps.box.seal(tokens.refreshToken) : null,
    refreshExpiresAt: consentEnds ?? new Date(base.connectedAt.getTime() + CONSENT_DAYS * 86_400_000),
    connectedByUserId: base.connectedByUserId,
    connectedAt: base.connectedAt,
  };
}

export type ConnectionStatus = { state: 'none' } | { state: 'connected' | 'expired'; connectedAt: Date; until: Date | null; environment: string };

export function statusOf(connection: TaxAuthorityConnectionRecord | null, environment: string, now: Date): ConnectionStatus {
  if (!connection || connection.environment !== environment) return { state: 'none' };
  const until = connection.refreshExpiresAt;
  const usable = connection.refreshTokenSealed !== null ? until === null || until > now : connection.accessExpiresAt > now;
  return { state: usable ? 'connected' : 'expired', connectedAt: connection.connectedAt, until, environment: connection.environment };
}

/** A usable access token for the profile, refreshing it once under the lock when it is about to lapse; null when none. */
export async function accessTokenFor(deps: TaxAuthorityDeps, organizationId: string, now: Date): Promise<string | null> {
  const quick = await deps.store.issuing.getTaxConnection(organizationId);
  if (statusOf(quick, deps.client.environment, now).state !== 'connected') return null;
  if (quick && quick.accessExpiresAt.getTime() - EXPIRY_MARGIN_MS > now.getTime()) return deps.box.open(quick.accessTokenSealed);
  return deps.store.issuing.withTaxConnectionLock(organizationId, async (current) => {
    if (!current || statusOf(current, deps.client.environment, now).state !== 'connected') return { update: null, result: null };
    // Another caller may have refreshed while this one waited: its token is good, and the old refresh token is spent.
    if (current.accessExpiresAt.getTime() - EXPIRY_MARGIN_MS > now.getTime()) return { update: null, result: deps.box.open(current.accessTokenSealed) };
    const refreshToken = current.refreshTokenSealed ? deps.box.open(current.refreshTokenSealed) : null;
    if (!refreshToken) return { update: null, result: null };
    try {
      const tokens = await deps.client.refresh(refreshToken);
      const update = connectionFrom(deps, tokens, current, now);
      return { update, result: tokens.accessToken };
    } catch {
      return { update: null, result: null };
    }
  });
}

/** MUT-572: does this document need an allocation number? A 305/320 to a customer with a VAT number, at or over the threshold. */
export function needsAllocation(doc: { docType: IssuedDocType; currency: string; documentDate: string; composed: ComposedDocument; customerTaxId: string | null }): boolean {
  if (doc.docType !== 'TAX_INVOICE' && doc.docType !== 'TAX_INVOICE_RECEIPT') return false;
  if (!doc.customerTaxId) return false;
  return aboveAllocationThreshold({ currency: doc.currency, occurredOn: doc.documentDate, netMinor: doc.composed.netMinor, vatMinor: doc.composed.vatMinor });
}

/** Our id for one issue request, the same on every retry of it (the Idempotency-Key), so the Tax Authority answers it once. */
export function allocationInvoiceId(organizationId: string, requestKey: string): string {
  return createHash('sha256').update(`${organizationId}:${requestKey}`).digest('hex').slice(0, 40);
}

const shekels = (minor: bigint) => Number(minor) / 100;

export function approvalRequest(input: {
  invoiceId: string;
  docType: 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT';
  number: number;
  vatNumber: string;
  customerTaxId: string;
  customerName: string;
  documentDate: string;
  issuedOn: string;
  composed: ComposedDocument;
  accountingSoftwareNumber: number;
  userName: string;
}): ApprovalRequest {
  const c = input.composed;
  const items: ApprovalItem[] = c.lines.map((l) => ({
    index: l.index,
    category: l.kind === 'GOODS' ? 1 : 2,
    description: l.description,
    quantity: Number(l.quantityMilli) / 1000,
    pricePerUnit: shekels(l.unitPriceMinor),
    discount: shekels(l.discountMinor),
    totalAmount: shekels(l.netMinor),
    vatRate: l.vatRateBasisPoints / 100,
    vatAmount: shekels(l.vatMinor),
  }));
  return {
    invoiceId: input.invoiceId,
    invoiceType: input.docType === 'TAX_INVOICE' ? 305 : 320,
    vatNumber: Number(input.vatNumber),
    invoiceReferenceNumber: String(input.number),
    customerVatNumber: Number(input.customerTaxId),
    customerName: input.customerName,
    invoiceDate: input.documentDate,
    invoiceIssuanceDate: input.issuedOn,
    accountingSoftwareNumber: input.accountingSoftwareNumber,
    userName: input.userName,
    amountBeforeDiscount: shekels(c.subtotalMinor),
    discount: shekels(c.discountMinor),
    paymentAmount: shekels(c.netMinor),
    vatAmount: shekels(c.vatMinor),
    paymentAmountIncludingVat: shekels(c.grossMinor),
    items,
  };
}

/**
 * The `allocate` hook the issue runs once its number is known: a token, then the Approval call, then the outcome the
 * store turns into a refusal or the number on the document (the last nine digits, as printed and as MUT-574 reads).
 */
export function allocator(deps: TaxAuthorityDeps, organizationId: string, now: Date, build: (number: number) => ApprovalRequest): (number: number) => Promise<AllocationOutcome> {
  return async (number) => {
    const token = await accessTokenFor(deps, organizationId, now);
    if (!token) return { kind: 'not_connected' };
    let answer: Awaited<ReturnType<TaxAuthorityClient['approve']>>;
    try {
      answer = await deps.client.approve(token, build(number));
    } catch {
      return { kind: 'unavailable' };
    }
    switch (answer.kind) {
      case 'approved':
        return { kind: 'allocated', number: answer.confirmationNumber.slice(-ALLOCATION_NUMBER_DIGITS), source: 'API' };
      case 'held':
        return { kind: 'held', message: answer.message };
      case 'refused':
        return { kind: 'refused', errors: answer.errors };
      case 'unauthorized':
        return { kind: 'not_connected' };
      case 'unavailable':
        return { kind: 'unavailable' };
    }
  };
}

/**
 * MUT-711 (ADR-273): where a business requests an allocation number by hand when MTB3A can't. The Tax Authority's own
 * site until the exact page is confirmed; TAX_AUTHORITY_MANUAL_ALLOCATION_URL overrides it.
 */
export const DEFAULT_MANUAL_ALLOCATION_URL = 'https://www.gov.il/he/departments/israel_tax_authority/govil-landing-page';

/**
 * MUT-711: the `allocate` hook for a number requested by hand. The document number it was requested for is only what
 * the preview showed (never reserved, so the numbering has no gaps): the issue goes ahead only if that is still the
 * number this document takes, under the counter's lock; otherwise nothing is written and the person asks again.
 */
export function manualAllocator(allocationNumber: string, forNumber: number): (number: number) => Promise<AllocationOutcome> {
  return async (number) => (number === forNumber ? { kind: 'allocated', number: allocationNumber, source: 'MANUAL' } : { kind: 'number_moved', requestedFor: forNumber, next: number });
}
