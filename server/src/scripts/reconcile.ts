import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { todayIn } from '../dates.js';
import { postDueItems } from '../agreements/posting.js';
import { PrismaLedgerStore } from '../repositories/prisma.js';
import type { LedgerStore } from '../repositories/ports.js';

/**
 * Scheduled reconcile (M5 brief decision 7): for every organization, post the
 * DATE installments and retainer charges whose date has arrived, in that
 * organization's timezone. Idempotent — the store makes every posting unique —
 * so a cron / Cloud Scheduler job may run it as often as it likes. The API's
 * lazy posting on reads remains the primary mechanism; this closes the gap
 * for organizations nobody reads for a while.
 *
 *   npm run reconcile            # all organizations
 *   npm run reconcile -- --dry   # list organizations and today in each timezone, post nothing
 */
export interface ReconcileLine {
  organizationId: string;
  slug: string;
  today: string;
  installmentsPosted: number;
  chargesCreated: number;
}

export async function reconcileAll(store: LedgerStore, now: Date, options: { dry?: boolean } = {}): Promise<ReconcileLine[]> {
  const lines: ReconcileLine[] = [];
  const organizations = await store.organizations.list();
  for (const organization of organizations) {
    const today = todayIn(organization.timezone, now);
    if (options.dry) {
      lines.push({ organizationId: organization.id, slug: organization.slug, today, installmentsPosted: 0, chargesCreated: 0 });
      continue;
    }
    const summary = await postDueItems(store, organization, today, now, { actorType: 'SYSTEM', actorId: null, requestId: `reconcile-${now.toISOString()}` });
    lines.push({ organizationId: organization.id, slug: organization.slug, today, installmentsPosted: summary.installmentsPosted, chargesCreated: summary.chargesCreated });
  }
  return lines;
}

const isMain = process.argv[1]?.endsWith('reconcile.ts') || process.argv[1]?.endsWith('reconcile.js');
if (isMain) {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = PrismaLedgerStore.connect(config.DATABASE_URL);
  const dry = process.argv.includes('--dry');
  try {
    const lines = await reconcileAll(store, new Date(), { dry });
    for (const line of lines) logger.info(line, dry ? 'reconcile (dry run)' : 'reconciled');
    logger.info({ organizations: lines.length, installmentsPosted: lines.reduce((n, l) => n + l.installmentsPosted, 0), chargesCreated: lines.reduce((n, l) => n + l.chargesCreated, 0) }, 'reconcile finished');
  } catch (err) {
    logger.error({ err }, 'reconcile failed');
    process.exitCode = 1;
  } finally {
    await store.disconnect();
  }
}
