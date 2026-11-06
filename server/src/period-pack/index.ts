import { ApiError } from '../errors.js';
import type { LedgerStore, Organization, PeriodEstimate } from '../repositories/ports.js';
import type { Lang } from './columns.js';
import { periodLabel, type PeriodRange } from './range.js';
import { boundsOf } from './rows.js';
import { mintTicket, type DownloadKind, type DownloadType, type TicketClaims } from './ticket.js';

/**
 * MUT-314 (ADR-248): download a period of one profile as an Excel report or a receipts zip. The module's only door
 * (an eslint rule refuses deep imports): the routes mint a ticket here, and the stream route verifies it, checks access
 * again, collects the rows and writes one of the two files.
 */
export { downloadUnavailable, recheckAccess, type RecheckContext } from './access.js';
export { monthRange, resolveAsOf, PERIOD_MAX_MONTHS, type PeriodRange } from './range.js';
export { collectRows, type PeriodRows } from './rows.js';
export { buildReport, XLSX_MIME } from './report.js';
export { receiptsZip, ZIP_MIME, RECEIPT_IDLE_MS } from './receipts-zip.js';
export { DOWNLOAD_TYPES, TICKET_TTL_MS, verifyTicket, type DownloadKind, type DownloadType, type TicketClaims } from './ticket.js';

/** PERIOD_PACK_MAX_ROWS's default: expense and income rows one report may hold (D13). */
export const PERIOD_PACK_MAX_ROWS_DEFAULT = 20_000;
/** PERIOD_PACK_MAX_RECEIPT_BYTES's default: 500 MiB of receipts in one zip (D13). */
export const PERIOD_PACK_MAX_RECEIPT_BYTES_DEFAULT = 500 * 1024 * 1024;
/** PERIOD_PACK_CONCURRENCY's default: streams one instance serves at once (D13). */
export const PERIOD_PACK_CONCURRENCY_DEFAULT = 3;
/** Mints per subject (a person, or a link's viewer) per hour, and how long a client waits when the instance is full. */
export const PERIOD_DOWNLOAD_POLICY = { mintsPerSubjectPerHour: 30, busyRetryAfterSeconds: 15 } as const;

export interface DownloadLimits {
  maxRows: number;
  maxReceiptBytes: number;
}

export interface MintInput {
  pepper: string;
  type: DownloadType;
  kind: DownloadKind;
  organization: Organization;
  /** The user id, or the link viewer's id. */
  sub: string;
  range: PeriodRange;
  asOf: Date;
  lang: Lang;
  now: Date;
  limits: DownloadLimits;
}

export interface MintedDownload {
  type: DownloadType;
  ticket: string;
  expiresAt: string;
  filename: string;
  estimate: PeriodEstimate;
}

/** The estimate, the cap for this type checked up front (422 PERIOD_TOO_LARGE), then a ticket. */
export async function mintDownload(store: LedgerStore, input: MintInput): Promise<MintedDownload> {
  const estimate = await store.periodPack.estimate(input.organization.id, boundsOf(input.range), input.asOf);
  const [size, limit] = input.type === 'report' ? [estimate.expenses + estimate.income, input.limits.maxRows] : [estimate.receiptBytes, input.limits.maxReceiptBytes];
  if (size > limit) {
    throw new ApiError('VALIDATION_FAILED', input.type === 'report' ? `This period has more than ${limit} rows; pick a shorter period` : 'This period’s receipts are too large for one download; pick a shorter period', {
      reason: 'PERIOD_TOO_LARGE',
      type: input.type,
      limit,
      estimate: size,
    });
  }
  const claims: TicketClaims = { type: input.type, kind: input.kind, org: input.organization.id, sub: input.sub, from: input.range.from, to: input.range.to, asOf: input.asOf.toISOString(), lang: input.lang };
  const { ticket, expiresAt } = mintTicket(input.pepper, claims, input.now);
  return { type: input.type, ticket, expiresAt: expiresAt.toISOString(), filename: downloadFilename(input.type, input.organization.name, input.range), estimate };
}

/** The profile's name as a file-name part: letters and digits of any script, the rest folded to dashes. */
export function profileSlug(name: string): string {
  const slug = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'profile';
}

/** D24: `mutaba3a-<profile>-<YYYY-MM>[_<YYYY-MM>].xlsx`, and the zip with a `-receipts` suffix. */
export function downloadFilename(type: DownloadType, profileName: string, range: PeriodRange): string {
  const base = `mutaba3a-${profileSlug(profileName)}-${periodLabel(range)}`;
  return type === 'report' ? `${base}.xlsx` : `${base}-receipts.zip`;
}

/** `attachment` with an ASCII fallback name and the UTF-8 one (RFC 6266 / 5987). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').replace(/--+/g, '-') || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** A per-instance count of streams in flight; a full instance answers 429 rather than queueing (D13). */
export class StreamSlots {
  private used = 0;
  constructor(private readonly size: number) {}
  tryAcquire(): (() => void) | null {
    if (this.used >= this.size) return null;
    this.used += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= 1;
    };
  }
}
