import { PrismaClient } from '@prisma/client';

/**
 * Checks that must pass before the new revision rolls (deploy.sh step 3, after `prisma migrate deploy`). Read-only:
 * each one answers what it found, and any finding stops the deploy before the service changes.
 *
 *   DATABASE_URL=… npm run pre-roll
 *
 * Needs only DATABASE_URL (deploy.sh passes the Cloud SQL proxy URL), not the service's configuration.
 */

export interface StrayMembership {
  organizationId: string;
  userId: string;
}

/**
 * MUT-373 (eng review OV1b): someone other than its owner holds a membership on an owned profile, and no operator
 * ever made them a co-owner. Such a row would have been refused since MUT-182 (2026-10-14); under MUT-373's rule an
 * OWNER-role one would silently make its holder an owner of someone's books. A co-owner the operator added is
 * recognized by the `membership.granted` audit row `grant:user --role owner` writes, so this keeps passing once
 * co-owners exist.
 */
export async function findStrayOwnedMemberships(db: PrismaClient): Promise<StrayMembership[]> {
  return db.$queryRaw<StrayMembership[]>`
    SELECT m."organizationId", m."userId"
      FROM memberships m
      JOIN organizations o ON o.id = m."organizationId"
     WHERE COALESCE(o."ownerUserId", o."personalOwnerUserId") IS NOT NULL
       AND m."userId" <> COALESCE(o."ownerUserId", o."personalOwnerUserId")
       AND NOT EXISTS (
         SELECT 1 FROM audit_events a
          WHERE a."organizationId" = m."organizationId" AND a."entityId" = m."userId"::text
            AND a.action = 'membership.granted' AND a.metadata->>'role' = 'OWNER')
     ORDER BY 1, 2`;
}

const isMain = process.argv[1]?.endsWith('pre-roll.ts') || process.argv[1]?.endsWith('pre-roll.js');
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('pre-roll: DATABASE_URL is not set');
    process.exit(1);
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const stray = await findStrayOwnedMemberships(db);
    for (const { organizationId, userId } of stray) console.error(`pre-roll: user ${userId} is a member of owned profile ${organizationId} without being made a co-owner`);
    if (stray.length > 0) {
      console.error(`pre-roll: ${stray.length} stray membership(s) on owned profiles; revoke each (npm run revoke:user) or confirm it with grant:user --role owner, then deploy again`);
      process.exitCode = 1;
    } else {
      console.log('pre-roll: no stray memberships on owned profiles');
    }
  } catch (err) {
    console.error('pre-roll: failed', err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
