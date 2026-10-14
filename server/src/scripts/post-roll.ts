import { Prisma, PrismaClient } from '@prisma/client';
import { isValidTimezone } from '../dates.js';
import { personalProfileFor } from '../personal-profile.js';
import type { UserLocale } from '../repositories/ports.js';

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

/**
 * MUT-182 (qa-reconcile D1): the migration stamps every existing MUT-120
 * profile owned + PERSONAL, but the old revision — serving between the
 * migration and the roll, or again after a rollback — writes new ones with
 * neither. Its row passes the CHECKs (they allow an unstamped personal
 * profile; SQL treats the NULL comparison as passing). `profileOwnerOf`
 * already treats such a row as its owner's, so this is housekeeping that
 * lets one column answer again. Run after the personal-profile backfill,
 * which writes stamped rows itself.
 */
export async function repairPersonalOwnership(db: PrismaClient): Promise<number> {
  return db.$executeRaw`UPDATE "organizations" SET "ownerUserId" = "personalOwnerUserId", "profileType" = 'PERSONAL' WHERE "personalOwnerUserId" IS NOT NULL AND "ownerUserId" IS NULL`;
}

export interface PersonalProfileBackfill {
  created: { userId: string; organizationId: string }[];
  /** NO_FIRM: nothing to take a currency and timezone from. INVALID_TIMEZONE: the firm's zone is not IANA (TD-091). */
  skipped: { userId: string; reason: 'NO_FIRM' | 'INVALID_TIMEZONE' }[];
}

/**
 * MUT-120: every user has exactly one personal profile, but the migration
 * shipped with no backfill (ADR-037 amendment), so a user provisioned before
 * it — or by the old revision during a roll — has none. Creates it exactly as
 * `POST /admin/v1/users` does, taking currency and timezone from the user's
 * oldest firm. The unique `personalOwnerUserId` index makes a concurrent
 * create lose cleanly, so a user is never given two.
 */
export async function backfillPersonalProfiles(db: PrismaClient, at = new Date()): Promise<PersonalProfileBackfill> {
  const users = await db.user.findMany({
    where: { personalProfile: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      locale: true,
      memberships: {
        // A firm: neither the user's personal profile nor one they created themselves (MUT-182) — only an operator firm has settings to copy.
        where: { organization: { ownerUserId: null } },
        orderBy: [{ createdAt: 'asc' }, { organizationId: 'asc' }],
        take: 1,
        select: { organization: { select: { defaultCurrency: true, timezone: true } } },
      },
    },
  });
  const result: PersonalProfileBackfill = { created: [], skipped: [] };
  for (const user of users) {
    const firm = user.memberships[0]?.organization;
    if (!firm) {
      result.skipped.push({ userId: user.id, reason: 'NO_FIRM' });
      continue;
    }
    if (!isValidTimezone(firm.timezone)) {
      result.skipped.push({ userId: user.id, reason: 'INVALID_TIMEZONE' });
      continue;
    }
    const organizationId = await createPersonalProfile(db, user.id, user.locale as UserLocale, firm, at);
    if (organizationId) result.created.push({ userId: user.id, organizationId });
  }
  return result;
}

/** Organization, membership and audit in one transaction; null when a concurrent create got there first. */
async function createPersonalProfile(
  db: PrismaClient,
  userId: string,
  locale: UserLocale,
  settings: { defaultCurrency: string; timezone: string },
  at: Date,
): Promise<string | null> {
  try {
    return await db.$transaction(async (tx) => {
      // MUT-182: owned and PERSONAL, as organizations_personal_owned_check requires of every MUT-120 profile.
      const organization = await tx.organization.create({ data: { ...personalProfileFor(locale, settings), personalOwnerUserId: userId, ownerUserId: userId, profileType: 'PERSONAL' } });
      await tx.membership.create({ data: { userId, organizationId: organization.id, createdAt: at } });
      const audit = { organizationId: organization.id, actorType: 'SYSTEM' as const, actorId: null, createdAt: at };
      await tx.auditEvent.createMany({
        data: [
          { ...audit, action: 'organization.created', entityType: 'organization', entityId: organization.id, metadata: { personal: true, ownerUserId: userId, backfill: 'post-roll' } },
          { ...audit, action: 'membership.granted', entityType: 'user', entityId: userId },
        ],
      });
      return organization.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
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
    const personal = await backfillPersonalProfiles(db);
    for (const { userId, organizationId } of personal.created) console.log(`post-roll: personal profile ${organizationId} created for user ${userId}`);
    for (const { userId, reason } of personal.skipped) console.warn(`post-roll: user ${userId} still has no personal profile (${reason}); provision one by hand`);
    console.log(`post-roll: ${personal.created.length} personal profile(s) backfilled, ${personal.skipped.length} skipped`);
    const stamped = await repairPersonalOwnership(db);
    console.log(`post-roll: ${stamped} personal profile(s) stamped owned + PERSONAL`);
  } catch (err) {
    console.error('post-roll: failed', err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
