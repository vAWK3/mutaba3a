import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Organization and user rows written in raw SQL, for migration tests that
 * build a database from the migrations *before* the one under test.
 *
 * Today's store cannot write these tables there: its Prisma client selects
 * every column the current schema declares (MUT-182 added three to
 * `organizations`), and the older database does not have them yet. Only the
 * columns that existed from Milestone 1 (and MUT-120's marker, when asked
 * for) are written, so the helpers fit every migration point.
 */
export async function insertFirmRow(db: PrismaClient, name = 'Firm'): Promise<{ id: string }> {
  const id = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt") VALUES ('${id}', '${name}', 'firm-${id.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', now())`,
  );
  return { id };
}

/** A user with their MUT-120 personal organization (needs a database at or after MUT-120) and a membership in each of `organizationIds`. */
export async function insertUserWithPersonalRow(db: PrismaClient, organizationIds: string[]): Promise<{ userId: string; personalId: string }> {
  const userId = randomUUID();
  const personalId = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO users (id, email, "displayName", "passwordHash", locale, "passwordChangedAt", "createdAt", "updatedAt") VALUES ('${userId}', 'n-${userId.slice(0, 8)}@firm.ps', 'Nour', 'x', 'en', now(), now(), now())`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO organizations (id, name, slug, "defaultCurrency", timezone, "updatedAt", "personalOwnerUserId") VALUES ('${personalId}', 'Personal', 'personal-${personalId.slice(0, 8)}', 'ILS', 'Asia/Jerusalem', now(), '${userId}')`,
  );
  for (const organizationId of [personalId, ...organizationIds]) {
    await db.$executeRawUnsafe(`INSERT INTO memberships ("userId", "organizationId", "createdAt") VALUES ('${userId}', '${organizationId}', now())`);
  }
  return { userId, personalId };
}
