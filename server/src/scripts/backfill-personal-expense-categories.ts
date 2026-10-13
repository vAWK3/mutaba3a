import { PrismaClient } from '@prisma/client';
import { categoryNameKey } from '../expenses/names.js';
import { PERSONAL_PRESET } from '../expenses/presets.js';

/**
 * MAL-1137 backfill: `PERSONAL_PRESET` only seeds a personal profile's
 * categories once, on its first `GET /v1/expense-categories` (MUT-42 D2), so a
 * profile that already had categories before MAL-1137 kept the old ten —
 * including "Projects", which the ticket retired. This brings an
 * already-seeded profile in line: adds the three categories it's missing, and
 * retires "Projects", moving its expenses to "Other" first (categories are
 * archived, never deleted — `routes/expense-categories.ts`).
 *
 *   DATABASE_URL=… npm run backfill:personal-categories            # apply
 *   DATABASE_URL=… npm run backfill:personal-categories -- --dry   # report only, writes nothing
 *
 * Idempotent: a category already present is skipped, an already-archived
 * "Projects" is left alone, so running it twice touches nothing the second time.
 */

/** The preset content MAL-1137 removed — frozen here only to find and retire it. */
const RETIRED_PROJECTS = { name: 'Projects', nameAr: 'المشاريع' };
const NEW_CATEGORY_NAMES = ['Shopping', 'Communications & Internet', 'Health & Insurance'];

export interface PersonalCategoryBackfillLine {
  organizationId: string;
  categoriesAdded: string[];
  expensesReassignedFromProjects: number;
  projectsArchived: boolean;
}

export interface PersonalCategoryBackfillResult {
  organizations: PersonalCategoryBackfillLine[];
}

/**
 * A profile's categories seed once in the signed-in user's language and the
 * user's current locale can drift afterward, so detect the seeded language
 * from "Groceries", a name every personal preset (old and new) carries
 * unchanged, rather than trust the user's current locale.
 */
function detectLocale(existingKeys: ReadonlySet<string>): 'en' | 'ar' {
  if (existingKeys.has(categoryNameKey('البقالة'))) return 'ar';
  return 'en';
}

export async function backfillPersonalExpenseCategories(db: PrismaClient, at = new Date(), options: { dry?: boolean } = {}): Promise<PersonalCategoryBackfillResult> {
  const organizations = await db.organization.findMany({ where: { personalOwnerUserId: { not: null } }, select: { id: true } });

  const result: PersonalCategoryBackfillResult = { organizations: [] };
  for (const org of organizations) {
    const categories = await db.expenseCategory.findMany({ where: { organizationId: org.id } });
    const byKey = new Map(categories.map((c) => [c.nameKey, c]));
    const locale = detectLocale(new Set(byKey.keys()));
    const line: PersonalCategoryBackfillLine = { organizationId: org.id, categoriesAdded: [], expensesReassignedFromProjects: 0, projectsArchived: false };

    const missing = PERSONAL_PRESET.filter((t) => NEW_CATEGORY_NAMES.includes(t.name) && !byKey.has(categoryNameKey(locale === 'ar' ? t.nameAr : t.name)));
    line.categoriesAdded = missing.map((t) => (locale === 'ar' ? t.nameAr : t.name));
    if (missing.length > 0 && !options.dry) {
      await db.expenseCategory.createMany({
        data: missing.map((t, i) => ({
          organizationId: org.id,
          name: locale === 'ar' ? t.nameAr : t.name,
          nameKey: categoryNameKey(locale === 'ar' ? t.nameAr : t.name),
          color: t.color,
          createdAt: new Date(at.getTime() + i),
          updatedAt: at,
        })),
        skipDuplicates: true,
      });
    }

    const projects = byKey.get(categoryNameKey(locale === 'ar' ? RETIRED_PROJECTS.nameAr : RETIRED_PROJECTS.name));
    if (projects && !projects.archivedAt) {
      const otherName = locale === 'ar' ? 'أخرى' : 'Other';
      const expenseCount = await db.expense.count({ where: { organizationId: org.id, categoryId: projects.id, deletedAt: null } });
      line.expensesReassignedFromProjects = expenseCount;
      line.projectsArchived = true;
      if (!options.dry) {
        let other = byKey.get(categoryNameKey(otherName));
        if (!other) {
          const otherTemplate = PERSONAL_PRESET.find((t) => t.name === 'Other')!;
          other = await db.expenseCategory.create({ data: { organizationId: org.id, name: otherName, nameKey: categoryNameKey(otherName), color: otherTemplate.color, createdAt: at, updatedAt: at } });
        }
        if (expenseCount > 0) await db.expense.updateMany({ where: { organizationId: org.id, categoryId: projects.id }, data: { categoryId: other.id, updatedAt: at } });
        await db.expenseCategory.update({ where: { id: projects.id }, data: { archivedAt: at, version: { increment: 1 }, updatedAt: at } });
        await db.auditEvent.create({
          data: {
            organizationId: org.id,
            actorType: 'SYSTEM',
            actorId: null,
            action: 'expense_category.updated',
            entityType: 'expense_category',
            entityId: projects.id,
            metadata: { fields: ['archived'], backfill: 'MAL-1137', reassignedExpenses: expenseCount },
          },
        });
      }
    }
    result.organizations.push(line);
  }
  return result;
}

const isMain = process.argv[1]?.endsWith('backfill-personal-expense-categories.ts') || process.argv[1]?.endsWith('backfill-personal-expense-categories.js');
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('backfill-personal-expense-categories: DATABASE_URL is not set');
    process.exit(1);
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  const dry = process.argv.includes('--dry');
  try {
    const result = await backfillPersonalExpenseCategories(db, new Date(), { dry });
    for (const line of result.organizations) {
      if (line.categoriesAdded.length === 0 && !line.projectsArchived) continue;
      console.log(
        `${dry ? '[dry] ' : ''}org ${line.organizationId}: +${line.categoriesAdded.length} categor${line.categoriesAdded.length === 1 ? 'y' : 'ies'} (${line.categoriesAdded.join(', ') || 'none'}), ${line.expensesReassignedFromProjects} expense(s) moved off Projects, Projects ${line.projectsArchived ? 'archived' : 'untouched'}`,
      );
    }
    const touched = result.organizations.filter((l) => l.categoriesAdded.length > 0 || l.projectsArchived).length;
    console.log(`backfill-personal-expense-categories: ${result.organizations.length} personal profile(s) checked, ${touched} touched${dry ? ' (dry run, nothing written)' : ''}`);
  } catch (err) {
    console.error('backfill-personal-expense-categories: failed', err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
