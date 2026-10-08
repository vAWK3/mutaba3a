import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, installmentDueDate, installmentView, postingDateFor, todayFor, validationError } from '../agreements/compose.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import type { LedgerStore } from '../repositories/ports.js';
import { InstallmentIdParamSchema, TriggerInstallmentRequestSchema, TriggerInstallmentResponseSchema } from '../schemas.js';
import { serializeInstallment, serializeReceivable } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse } from './shared.js';

/** /v1/installments/{id}/trigger — manual milestones (M3 brief §2.3). */
export function installmentRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/installments/{installmentId}/trigger',
      tags: ['Installments'],
      summary: 'Post a MANUAL installment (idempotent)',
      description: 'Creates the receivable, due per the installment’s or agreement’s payment terms unless dueDate is given. A second call returns the same receivable with created=false.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'installments.trigger')] as const,
      request: { params: InstallmentIdParamSchema, headers: IdempotencyHeaderSchema, body: { required: false, content: { 'application/json': { schema: TriggerInstallmentRequestSchema } } } },
      responses: {
        200: { description: 'Already posted', content: { 'application/json': { schema: TriggerInstallmentResponseSchema } } },
        201: { description: 'Posted', content: { 'application/json': { schema: TriggerInstallmentResponseSchema } } },
        ...notFoundResponse,
        ...conflictResponse,
        ...validationResponse,
        ...errorResponses,
      },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = (c.req.valid('json') ?? {}) as { dueDate?: string | undefined };
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const installment = await store.agreements.getInstallment(organization.id, c.req.valid('param').installmentId);
      if (!installment) throw new ApiError('NOT_FOUND', 'No such installment');
      const agreement = await store.agreements.getById(organization.id, installment.agreementId);
      if (!agreement) throw new ApiError('NOT_FOUND', 'No such installment');
      if (agreement.status === 'CANCELLED' || installment.voidedAt) throw new ApiError('CONFLICT', 'The agreement is cancelled', { reason: 'AGREEMENT_CANCELLED' });
      if (installment.triggerType !== 'MANUAL') throw validationError('NOT_MANUAL', `This installment posts ${installment.triggerType === 'IMMEDIATE' ? 'immediately' : 'on its date'}; only MANUAL installments are triggered`);
      if (body.dueDate) assertIsoDate(body.dueDate, 'dueDate');

      const postingDate = postingDateFor(installment, agreement.agreementDate, today);
      const dueDate = body.dueDate ?? installmentDueDate(installment, agreement, postingDate);
      const result = await store.agreements.postInstallment(organization.id, installment.id, { postingDate, dueDate, at: now });
      if (!result) throw new ApiError('NOT_FOUND', 'No such installment');
      if (result.created) {
        await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'installment.posted', entityType: 'installment', entityId: installment.id, metadata: { agreementId: agreement.id, receivableId: result.receivable.id, trigger: 'MANUAL', dueDate }, requestId: c.get('requestId') });
      }
      const view = installmentView(result.installment, agreement, today, result.receivable.paidMinor);
      return c.json({ installment: serializeInstallment({ installment: result.installment, currency: agreement.currency, ...view }), receivable: serializeReceivable(result.receivable, today), created: result.created }, result.created ? 201 : 200);
    },
  );

  return app;
}
