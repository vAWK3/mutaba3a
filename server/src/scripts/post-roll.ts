import { PrismaClient } from '@prisma/client';

/**
 * Data repairs that must run after the new revision serves (deploy.sh step 6).
 * A migration runs before the roll, so anything the old revision writes in
 * between — or after a rollback to it — misses that migration's backfill.
 * Every repair here is an idempotent WHERE + UPDATE: running it on every
 * deploy is the point, and a clean database answers 0.
 *
 *   DATABASE_URL=… npm run post-roll
 *
 * Needs only DATABASE_URL (deploy.sh passes the Cloud SQL proxy URL), not the
 * service's full configuration.
 */

/**
 * MUT-61: a payment a person recorded carries their createdByUserId and must be
 * origin CAPTURE; Malafat's key never sets createdByUserId. The migration's
 * backfill covers rows that existed when it ran; this covers the rest.
 */
export async function repairCaptureOrigins(db: PrismaClient): Promise<number> {
  return db.$executeRaw`UPDATE "payments" SET "origin" = 'CAPTURE' WHERE "origin" = 'INTEGRATION' AND "createdByUserId" IS NOT NULL`;
}

const isMain = process.argv[1]?.endsWith('post-roll.ts') || process.argv[1]?.endsWith('post-roll.js');
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('post-roll: DATABASE_URL is not set');
    process.exit(1);
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const captures = await repairCaptureOrigins(db);
    console.log(`post-roll: ${captures} captured payment(s) re-marked origin CAPTURE`);
  } catch (err) {
    console.error('post-roll: failed', err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
