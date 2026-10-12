import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, requireScope, type AppEnv } from '../auth/middleware.js';
import { todayFor, validationError } from '../agreements/compose.js';
import { COMMISSION_RATE_RULE, isCommissionRate } from '../agreements/contingency.js';
import { agreementDetail } from '../agreements/create.js';
import { assertActiveContingency, composeOutcome, outcomeAuditFigures, outcomeHasPayments, priorOutcomeFigures, type ComposedOutcome } from '../agreements/outcome.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { formatMoney, type Currency } from '../money.js';
import { verifyPreviewToken } from '../preview-token.js';
import type { AgreementRecord, ContingencyTermsPatch, InstallmentRecord, JsonObject, LedgerStore, Organization, OutcomeWriteInput } from '../repositories/ports.js';
import {
  AgreementDetailSchema,
  AgreementIdParamSchema,
  ContingencyOutcomeCorrectRequestSchema,
  ContingencyOutcomePreviewRequestSchema,
  ContingencyOutcomePreviewSchema,
  ContingencyOutcomeRequestSchema,
  ContingencyTermsPatchRequestSchema,
  IfMatchHeaderSchema,
} from '../schemas.js';
import { mustGet } from './agreements.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

interface Actor {
  organization: Organization;
  apiKeyId: string;
  requestId: string;
}

/**
 * /v1/agreements/{id}/contingency and /outcome* — contingency fee agreements
 * (MUT-100). Created through POST /v1/agreements with `contingency`; here the
 * terms change before an outcome, the outcome is previewed and recorded, and
 * a recorded outcome is corrected while its commission is unpaid. Malafat is
 * the only writer (API key, `agreements:write`); sessions read.
 */
export function contingencyRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const audit = (a: Actor, action: string, entityType: string, entityId: string, metadata: JsonObject) =>
    store.audit.append({ organizationId: a.organization.id, actorType: 'API_KEY', actorId: a.apiKeyId, action, entityType, entityId, metadata, requestId: a.requestId });

  /** A version check lost to a concurrent write: say what moved, from a fresh read. */
  async function raced(organizationId: string, agreementId: string, expectOutcome: boolean): Promise<ApiError> {
    const latest = await mustGet(store, organizationId, agreementId);
    if (!expectOutcome && latest.outcome !== null) return new ApiError('CONFLICT', 'An outcome was recorded concurrently', { reason: 'OUTCOME_ALREADY_RECORDED' });
    if (expectOutcome && latest.outcome === null) return new ApiError('CONFLICT', 'No outcome is recorded', { reason: 'OUTCOME_NOT_RECORDED' });
    return new ApiError('CONFLICT', 'The agreement changed concurrently; preview again', { reason: 'VERSION_MISMATCH', currentVersion: latest.version });
  }

  /** Posts the new commission line now, dated on the outcome date; a crash here heals through the lazy path. */
  async function postCommission(a: Actor, agreementId: string, installments: InstallmentRecord[], c: ComposedOutcome, now: Date): Promise<{ installmentId: string | null; receivableId: string | null }> {
    const line = c.line ? installments.find((i) => i.isCommission && i.voidedAt === null && i.position === c.line?.position) : undefined;
    if (!line || !c.postingDate || !c.dueDate) return { installmentId: null, receivableId: null };
    const posted = await store.agreements.postInstallment(a.organization.id, line.id, { postingDate: c.postingDate, dueDate: c.dueDate, at: now });
    if (posted?.created) await audit(a, 'installment.posted', 'installment', line.id, { agreementId, receivableId: posted.receivable.id, trigger: 'DATE' });
    return { installmentId: line.id, receivableId: posted?.receivable.id ?? null };
  }

  const outcomeWrite = (c: ComposedOutcome, agreement: AgreementRecord): OutcomeWriteInput => ({
    outcome: c.outcome,
    outcomeDate: c.outcomeDate,
    awardedAmountMinor: c.awardedMinor,
    outcomeNote: c.note,
    commissionRateBasisPoints: c.rate,
    upfrontTreatment: c.treatment,
    commissionInstallment: c.line,
    totals: c.totals,
    expectedVersion: agreement.version,
  });

  // ---- terms ----
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/agreements/{agreementId}/contingency',
      tags: ['Agreements'],
      summary: 'Change a contingency agreement’s commission rate or upfront treatment before its outcome',
      description: 'If-Match carries the version you read. After an outcome the terms are frozen (409 OUTCOME_ALREADY_RECORDED); a correction (POST …/outcome/correct) may fix them while the commission is unpaid.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), ifMatch()] as const,
      request: { params: AgreementIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(ContingencyTermsPatchRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      const from = assertActiveContingency(agreement);
      if (agreement.outcome !== null) throw new ApiError('CONFLICT', 'The outcome is recorded; a correction may fix the terms', { reason: 'OUTCOME_ALREADY_RECORDED' });
      if (body.commissionRateBasisPoints !== undefined && !isCommissionRate(body.commissionRateBasisPoints)) {
        throw validationError('COMMISSION_RATE_INVALID', COMMISSION_RATE_RULE, { field: 'commissionRateBasisPoints' });
      }
      const to = { rate: body.commissionRateBasisPoints ?? from.rate, treatment: body.upfrontTreatment ?? from.treatment };
      if (to.rate === from.rate && to.treatment === from.treatment) throw validationError('CHANGE_NOTHING_CHANGED', 'The terms are already these');
      const patch: ContingencyTermsPatch = { ...(to.rate !== from.rate ? { commissionRateBasisPoints: to.rate } : {}), ...(to.treatment !== from.treatment ? { upfrontTreatment: to.treatment } : {}) };
      const result = await store.agreements.updateContingencyTerms(organization.id, agreement.id, c.get('expectedVersion'), patch, now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such agreement');
      if (result.kind === 'stale') throw await raced(organization.id, agreement.id, false);
      await audit({ organization, apiKeyId: apiKey.id, requestId: c.get('requestId') }, 'agreement.contingency_terms_changed', 'agreement', agreement.id, {
        from: { commissionRateBasisPoints: from.rate, upfrontTreatment: from.treatment },
        to: { commissionRateBasisPoints: to.rate, upfrontTreatment: to.treatment },
      });
      return c.json(await agreementDetail(store, organization, result.record, todayFor(organization, now)), 200);
    },
  );

  // ---- outcome preview ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/outcome/preview',
      tags: ['Agreements'],
      summary: 'Preview a contingency outcome, or a correction of one: the commission, what the upfront covers, and the bill',
      description:
        'Writes nothing. mode is RECORD before an outcome exists and CORRECT after; send the same body (plus previewToken) to /outcome or /outcome/correct. The token covers the body, the agreement version, the VAT rate on outcomeDate, the counted upfront, the commission, the billable amount and — when correcting — the replaced receivable’s version, so a credit or payment in between is 409 PREVIEW_STALE.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: AgreementIdParamSchema, body: jsonBody(ContingencyOutcomePreviewRequestSchema) },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: ContingencyOutcomePreviewSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = keyAuth(c);
      const body = c.req.valid('json');
      const today = todayFor(organization, c.get('now')());
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      const mode = agreement.type === 'CONTINGENCY' && agreement.outcome !== null ? 'CORRECT' : 'RECORD';
      const composed = await composeOutcome(store, organization, agreement, body, mode, today);
      return c.json(composed.wire, 200);
    },
  );

  // ---- record ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/outcome',
      tags: ['Agreements'],
      summary: 'Record a contingency outcome from a preview: AWARDED bills the commission once, NO_RECOVERY bills nothing',
      description: 'The commission is an installment on the agreement, DATE-triggered on outcomeDate and posted at once with VAT at the rate in force on that date. Nothing posts when the bill is zero (NO_RECOVERY, or CREDITED with the upfront covering the commission). A second record is 409 OUTCOME_ALREADY_RECORDED.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.outcome')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ContingencyOutcomeRequestSchema) },
      responses: { 200: { description: 'Recorded', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const actor = { organization, apiKeyId: apiKey.id, requestId: c.get('requestId') };
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      const composed = await composeOutcome(store, organization, agreement, body, 'RECORD', today);
      if (!verifyPreviewToken(token, composed.tokenParts)) throw stalePreview();
      const result = await store.agreements.recordOutcome(organization.id, agreement.id, outcomeWrite(composed, agreement), now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such agreement');
      if (result.kind === 'stale') throw await raced(organization.id, agreement.id, false);
      const ids = await postCommission(actor, agreement.id, result.record.installments, composed, now);
      await audit(actor, 'agreement.outcome_recorded', 'agreement', agreement.id, outcomeAuditFigures(composed, agreement.currency as Currency, ids));
      return c.json(await agreementDetail(store, organization, await mustGet(store, organization.id, agreement.id), today), 200);
    },
  );

  // ---- correct ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/outcome/correct',
      tags: ['Agreements'],
      summary: 'Correct a recorded outcome while its commission is unpaid: credit the old commission in full and post the new one',
      description:
        'One transaction: the replaced commission’s receivable is credited in full (correctionReason becomes the credit’s reason), its line is voided, and the new outcome, terms and commission line are written; the new line posts at once. Refused with 409 OUTCOME_HAS_PAYMENTS once the commission has a payment or credit — re-checked under the receivable’s lock, so a payment racing the correction is refused too. The body may also fix commissionRateBasisPoints and upfrontTreatment.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.outcome_correct')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ContingencyOutcomeCorrectRequestSchema) },
      responses: { 200: { description: 'Corrected', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const actor = { organization, apiKeyId: apiKey.id, requestId: c.get('requestId') };
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      const composed = await composeOutcome(store, organization, agreement, body, 'CORRECT', today);
      if (!verifyPreviewToken(token, composed.tokenParts)) throw stalePreview();
      const before = priorOutcomeFigures(agreement, composed.replaced);
      const result = await store.agreements.correctOutcome(
        organization.id,
        agreement.id,
        { ...outcomeWrite(composed, agreement), replaceInstallmentId: composed.replaced?.id ?? null, credit: { reason: body.correctionReason, effectiveDate: today, requestId: actor.requestId } },
        now,
      );
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such agreement');
      if (result.kind === 'has_payments') throw outcomeHasPayments(result.receivableId);
      if (result.kind === 'stale') throw await raced(organization.id, agreement.id, true);

      const credit = result.record.credit;
      if (credit) {
        const receivable = await store.receivables.getById(organization.id, credit.receivableId);
        await audit(actor, 'receivable.credited', 'receivable', credit.receivableId, {
          creditId: credit.id,
          amount: formatMoney({ minor: credit.amountMinor, currency: agreement.currency as Currency }),
          reason: credit.reason,
          source: 'OUTCOME_CORRECTION',
          agreementId: agreement.id,
          settled: receivable?.status === 'SETTLED',
        });
      }
      const ids = await postCommission(actor, agreement.id, result.record.installments, composed, now);
      await audit(actor, 'agreement.outcome_corrected', 'agreement', agreement.id, {
        reason: body.correctionReason,
        replacedInstallmentId: composed.replaced?.id ?? null,
        replacedReceivableId: composed.replaced?.receivableId ?? null,
        creditId: credit?.id ?? null,
        before,
        after: outcomeAuditFigures(composed, agreement.currency as Currency, ids),
      });
      return c.json(await agreementDetail(store, organization, await mustGet(store, organization.id, agreement.id), today), 200);
    },
  );

  return app;
}

function stalePreview(): ApiError {
  return new ApiError('CONFLICT', 'previewToken does not match this body and the ledger as it stands; preview again', { reason: 'PREVIEW_STALE' });
}
