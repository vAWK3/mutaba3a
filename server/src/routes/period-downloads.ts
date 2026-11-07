import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AccountantPlanConfig } from '../billing/accountant-plan.js';
import type { Context } from 'hono';
import type { AttachmentStorage } from '../attachments/storage.js';
import { requireScope, sessionAuth, type AppEnv, type SessionSettings } from '../auth/middleware.js';
import { periodDownloadStoreGuard } from '../auth/store-guard.js';
import { todayIn } from '../dates.js';
import { ApiError } from '../errors.js';
import { pullStream } from '../http/pull-stream.js';
import type { Logger } from '../logger.js';
import {
  PERIOD_DOWNLOAD_POLICY,
  type StreamSlots,
  type UsedTickets,
  XLSX_MIME,
  ZIP_MIME,
  buildReport,
  collectRows,
  contentDisposition,
  downloadFilename,
  downloadUnavailable,
  mintDownload,
  monthRange,
  receiptsZip,
  recheckAccess,
  resolveAsOf,
  verifyTicket,
  type DownloadLimits,
  type TicketClaims,
} from '../period-pack/index.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, PeriodDownloadStreamRequestSchema, PeriodDownloadTicketQuerySchema, PeriodDownloadTicketSchema } from '../schemas.js';

/**
 * MUT-314 (ADR-248): download a period of one profile, in two steps (D3).
 *
 *   GET  /v1/period-downloads/ticket   owner, co-owner, member or accountant (session or device bearer + profile header):
 *                                      the estimate, the cap checked up front, and a 120-second ticket
 *   POST /v1/share-links/download-ticket  the same for a share link's visitor (routes/share-links.ts)
 *   POST /v1/period-downloads/stream   public: the ticket (and a link's viewer token) in a JSON or form body; access
 *                                      checked again, then the Excel report (Content-Length) or the receipts zip (chunked)
 *
 * The stream runs under a read-only store guard for every kind (D13 of MUT-559's layers); its audit row goes through
 * the base store. A download is a read: it never lazy-posts (D15). Tokens travel in bodies only.
 */
export const PERIOD_DOWNLOAD_MINT_ENDPOINT = 'GET /v1/period-downloads/ticket';
export const PERIOD_DOWNLOAD_STREAM_ENDPOINT = 'POST /v1/period-downloads/stream';
export const PERIOD_DOWNLOAD_LINK_MINT_ENDPOINT = 'POST /v1/share-links/download-ticket';
/** Every endpoint the feature adds: PERIOD_DOWNLOADS off answers 404 for each, before authentication. */
export const PERIOD_DOWNLOAD_ENDPOINTS: ReadonlySet<string> = new Set([PERIOD_DOWNLOAD_MINT_ENDPOINT, PERIOD_DOWNLOAD_STREAM_ENDPOINT, PERIOD_DOWNLOAD_LINK_MINT_ENDPOINT]);

/** What the mint routes (this file's and the share link's) and the stream share. */
export interface PeriodDownloadServices {
  limits: DownloadLimits;
  /** PERIOD_DOWNLOAD_POLICY.mintsPerSubjectPerHour, keyed per person or viewer. */
  mintLimiter: RateLimiter;
  slots: StreamSlots;
  /** Each ticket streams once (review, MUT-314). */
  usedTickets: UsedTickets;
}

export interface PeriodDownloadRouteOptions {
  /** The guarded store the rows are read through. */
  store: LedgerStore;
  /** The store beneath the guard: the stream's access re-check and its audit row. */
  baseStore: LedgerStore;
  settings: SessionSettings;
  services: PeriodDownloadServices;
  storage: AttachmentStorage | null;
  accountantAccess: boolean;
  /** MUT-565 (ACCOUNTANT_PLAN): the stream re-check applies the plan's client-books cap. Absent = off. */
  accountantPlan?: AccountantPlanConfig;
  shareLinks: boolean;
  logger: Pick<Logger, 'error' | 'info'>;
}

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function rateLimited(c: Context<AppEnv>, retryAfterSeconds: number, message: string): ApiError {
  c.header('Retry-After', String(retryAfterSeconds));
  return new ApiError('RATE_LIMITED', message, { retryAfterSeconds });
}

/** 30 mints per subject per hour (D13). */
export async function checkMintBudget(c: Context<AppEnv>, limiter: RateLimiter, subject: string): Promise<void> {
  const budget = await limiter.check(`period-mint:${subject}`, c.get('now')());
  if (!budget.allowed) throw rateLimited(c, budget.retryAfterSeconds, 'Too many downloads; try again later');
}

export function periodDownloadRoutes(options: PeriodDownloadRouteOptions): OpenAPIHono<AppEnv> {
  const { store, baseStore, settings, services, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/period-downloads/ticket',
      tags: ['Your data'],
      summary: 'Start a period download: its size, and a ticket for the stream',
      description: `MUT-314 (ADR-248). Whole calendar months (\`from\`…\`to\`, YYYY-MM, at most 24, never past the profile's current month) of the profile named by X-Mutaba3a-Profile. \`type=report\` is the Excel report (Expenses, Income and a per-currency Summary, always both sheets); \`type=receipts\` the receipt files, named by Ref, with index.csv. Over ${PERIOD_DOWNLOAD_POLICY.mintsPerSubjectPerHour} starts an hour: 429. Over the report's row cap or the zip's byte cap: 422 VALIDATION_FAILED, details.reason PERIOD_TOO_LARGE with { type, limit, estimate }: pick a shorter period. Owners, members and accountants alike; a lapsed profile still downloads.`,
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read'), requireScope('payments:read'), requireScope('attachments:read')] as const,
      request: { query: PeriodDownloadTicketQuerySchema },
      responses: {
        200: { description: 'The ticket', content: { 'application/json': { schema: PeriodDownloadTicketSchema } } },
        404: errorResponse('No such profile for you, or period downloads are off on this server'),
        422: errorResponse('VALIDATION_FAILED: details.reason PERIOD_RANGE, AS_OF or PERIOD_TOO_LARGE'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      const auth = sessionAuth(c);
      const query = c.req.valid('query');
      const now = c.get('now')();
      await checkMintBudget(c, services.mintLimiter, `user:${auth.user.id}`);
      const range = monthRange(query, todayIn(auth.organization.timezone, now));
      const asOf = resolveAsOf(query.asOf, now);
      const minted = await mintDownload(store, {
        pepper: settings.pepper,
        type: query.type,
        kind: auth.access === 'accountant' ? 'accountant' : 'member',
        organization: auth.organization,
        sub: auth.user.id,
        sid: auth.session.id,
        range,
        asOf,
        lang: query.lang ?? auth.user.locale,
        now,
        limits: services.limits,
      });
      return c.json(minted, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/period-downloads/stream',
      tags: ['Your data'],
      summary: 'Download a period: the file a ticket names',
      description: `MUT-314 (ADR-248). The ticket from GET /v1/period-downloads/ticket or POST /v1/share-links/download-ticket, in the body (a form post works: the browser's own downloader saves the file), within 120 seconds; a share link's also carries its viewer token. Access is checked again here, so a revoke after the ticket wins. The report: ${XLSX_MIME} with Content-Length. The receipts: application/zip, streamed; a receipt the bucket can't give is listed \`missing\` in index.csv. 404 (one answer for every cause) for a bad, expired or no longer authorised ticket; 429 with Retry-After when this server is busy. Audited as period.downloaded.`,
      security: [],
      request: {
        // Not `required`: each validator then runs only for its own content type (a JSON call, or the portal's form).
        body: {
          required: false,
          content: { 'application/json': { schema: PeriodDownloadStreamRequestSchema }, 'application/x-www-form-urlencoded': { schema: PeriodDownloadStreamRequestSchema } },
        },
      },
      responses: {
        200: {
          description: 'The file, as an attachment',
          content: { [XLSX_MIME]: { schema: { type: 'string', format: 'binary' } }, [ZIP_MIME]: { schema: { type: 'string', format: 'binary' } } },
        },
        404: errorResponse('NOT_FOUND, details.reason DOWNLOAD_UNAVAILABLE'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED: this server is serving its most downloads; retry shortly'),
        503: errorResponse('ATTACHMENTS_NOT_CONFIGURED (receipts only)'),
      },
    }),
    async (c) => {
      const form = /^application\/x-www-form-urlencoded/i.test(c.req.header('content-type') ?? '');
      const parsed = PeriodDownloadStreamRequestSchema.safeParse(form ? c.req.valid('form') : c.req.valid('json'));
      if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'Send the ticket in a JSON or form body', { field: 'ticket' });
      const body = parsed.data;
      const now = c.get('now')();
      const claims = verifyTicket(settings.pepper, body.ticket, now);
      if (!claims || (claims.kind === 'link' && !options.shareLinks)) throw downloadUnavailable();
      if (!services.usedTickets.claim(claims.n, claims.exp, now)) throw downloadUnavailable();
      // Before any read: nothing below may write, whoever asked.
      c.set('storeGuard', periodDownloadStoreGuard(claims.kind));
      const { organization, shareLinkId } = await recheckAccess(claims, { store: baseStore, pepper: settings.pepper, accountantAccess: options.accountantAccess, ...(options.accountantPlan ? { accountantPlan: options.accountantPlan } : {}), viewerToken: body.viewerToken ?? null, now });
      if (claims.type === 'receipts' && !options.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
      const release = services.slots.tryAcquire();
      if (!release) throw rateLimited(c, PERIOD_DOWNLOAD_POLICY.busyRetryAfterSeconds, 'Too many downloads on this server right now; retry shortly');
      try {
        return await respond(c, claims, organization, shareLinkId, release);
      } catch (error) {
        release();
        throw error;
      }
    },
  );

  async function respond(c: Context<AppEnv>, claims: TicketClaims, organization: Organization, shareLinkId: string | null, release: () => void): Promise<Response> {
    const range = { from: claims.from, to: claims.to };
    const rows = await collectRows(store, organization, range, new Date(claims.asOf), claims.lang, { scope: claims.type === 'report' ? 'report' : 'receipts', forLink: claims.kind === 'link' });
    const requestId = c.get('requestId');
    const receiptFiles = rows.expenses.reduce((n, line) => n + line.receipts.length, 0);
    await baseStore.audit.append({
      organizationId: organization.id,
      actorType: claims.kind === 'link' ? 'SYSTEM' : 'USER',
      actorId: claims.kind === 'link' ? null : claims.sub,
      action: 'period.downloaded',
      entityType: 'organization',
      entityId: organization.id,
      metadata: {
        type: claims.type,
        kind: claims.kind,
        from: claims.from,
        to: claims.to,
        rows: rows.expenses.length + rows.income.length,
        ...(claims.type === 'receipts' && { receiptFiles }),
        ...(shareLinkId && { shareLinkId }),
      },
      requestId,
    });
    c.header('Content-Disposition', contentDisposition(downloadFilename(claims.type, organization.name, range)));
    c.header('X-Content-Type-Options', 'nosniff');
    if (claims.type === 'report') {
      const bytes = buildReport(rows);
      release();
      c.header('Content-Type', XLSX_MIME);
      c.header('Content-Length', String(bytes.byteLength));
      return c.body(bytes as Uint8Array<ArrayBuffer>, 200);
    }
    const zip = receiptsZip(rows, {
      storage: options.storage!,
      onMissing: (missing) => logger.error({ requestId, organizationId: organization.id, missing }, 'period download: receipts missing from the bucket'),
    });
    const stream = pullStream(zip, {
      onError: (error) => logger.error({ err: error, requestId }, 'period download failed mid-stream'),
      onCancel: () => logger.info({ requestId }, 'period download cancelled'),
      onSettled: release,
    });
    c.header('Content-Type', ZIP_MIME);
    return c.body(stream, 200);
  }

  return app;
}
