import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import type { CachedFxRates } from '../fx-rates.js';
import type { LedgerStore } from '../repositories/ports.js';
import { attachmentRoutes } from './attachments.js';
import { conversionRoutes } from './conversions.js';
import { expenseCategoryRoutes } from './expense-categories.js';
import { expenseGroupRoutes } from './expense-groups.js';
import { expenseRoutes } from './expenses.js';
import { fxRateRoutes } from './fx-rates.js';
import { incomeRoutes } from './income.js';
import type { CurrentTerms } from '../legal.js';
import { meRoutes } from './me.js';
import { customerRoutes } from './customers.js';
import { paymentRoutes } from './payments.js';
import { profileRoutes } from './profiles.js';
import { projectRoutes } from './projects.js';
import { receivableRoutes } from './receivables.js';
import { summaryRoutes } from './summaries.js';
import { vendorRoutes } from './vendors.js';

/**
 * Everything the hosted portal (`src/hosted/api/client.ts`) calls, as one
 * canonical list (MUT-286). `createApp()` registers it over the full Node
 * stack (real attachment storage, real FX cache); the portal's upcoming
 * local-mode backend (MUT-286 Phase B) registers the same list over an
 * in-page `MemoryLedgerStore`, with `attachments: null` (no bucket locally —
 * same "null = 503 ATTACHMENTS_NOT_CONFIGURED" contract an unconfigured
 * hosted deployment already gets) and no cached FX rates. One list means one
 * seam to keep in sync with the client, enforced by
 * `__tests__/portal-routes-coverage.test.ts`.
 */
export interface PortalRouteDependencies {
  store: LedgerStore;
  attachments: { storage: AttachmentStorage | null; urlTtlSeconds: number };
  fxRates: CachedFxRates | null;
  /** MUT-324: the terms /v1/me reports; null where none apply (the portal's signed-out mode). */
  terms: CurrentTerms | null;
  /** MUT-358: whether /v1/me reports billing; false in the portal's signed-out mode, which has none. */
  billing: boolean;
  /**
   * MUT-255 (decision P1): whether this app has the receipts library. Deleting an expense then sends its READY
   * receipts back to the library instead of deleting them; false in the portal's signed-out mode, which has none, and
   * on the hosted server unless RECEIPTS_LIBRARY is on (MUT-389).
   */
  receiptsLibrary: boolean;
}

export const PORTAL_ROUTES: ReadonlyArray<(deps: PortalRouteDependencies) => OpenAPIHono<AppEnv>> = [
  (deps) => customerRoutes(deps.store),
  (deps) => projectRoutes(deps.store),
  (deps) => receivableRoutes(deps.store),
  (deps) => paymentRoutes(deps.store),
  (deps) => summaryRoutes(deps.store, deps.fxRates),
  (deps) => attachmentRoutes(deps.store, deps.attachments),
  (deps) => expenseRoutes(deps.store, { ...deps.attachments, receiptsLibrary: deps.receiptsLibrary }),
  (deps) => expenseCategoryRoutes(deps.store),
  (deps) => vendorRoutes(deps.store),
  (deps) => incomeRoutes(deps.store),
  (deps) => expenseGroupRoutes(deps.store),
  (deps) => conversionRoutes(deps.store),
  (deps) => fxRateRoutes(deps.fxRates),
  (deps) => profileRoutes(deps.store),
  (deps) => meRoutes(deps.store, deps.terms, deps.billing),
];
