import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { categoryNameKey } from '../../expenses/names.js';
import { PrismaLedgerStore } from '../../repositories/prisma.js';
import { backfillPersonalExpenseCategories } from '../backfill-personal-expense-categories.js';

/**
 * MAL-1137 shipped a new `PERSONAL_PRESET`, but seeding only ever fires once
 * per profile (MUT-42 D2), so a personal profile that already had categories
 * kept the old ten, "Projects" included. This backfill brings it in line.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

/** What a personal profile looked like before MAL-1137: the old ten, pre-seeded directly. */
const OLD_PERSONAL_PRESET_EN = [
  { name: 'Transportation', color: '#0ea5e9' },
  { name: 'Car', color: '#ef4444' },
  { name: 'Rent', color: '#6366f1' },
  { name: 'Groceries', color: '#22c55e' },
  { name: 'Supplies', color: '#14b8a6' },
  { name: 'Gifts', color: '#ec4899' },
  { name: 'Investments', color: '#a855f7' },
  { name: 'Projects', color: '#3b82f6' },
  { name: 'Leisure', color: '#f59e0b' },
  { name: 'Other', color: '#78716c' },
];
const OLD_PERSONAL_PRESET_AR = [
  { name: 'المواصلات', color: '#0ea5e9' },
  { name: 'السيارة', color: '#ef4444' },
  { name: 'الإيجار', color: '#6366f1' },
  { name: 'البقالة', color: '#22c55e' },
  { name: 'المستلزمات', color: '#14b8a6' },
  { name: 'الهدايا', color: '#ec4899' },
  { name: 'الاستثمارات', color: '#a855f7' },
  { name: 'المشاريع', color: '#3b82f6' },
  { name: 'الترفيه', color: '#f59e0b' },
  { name: 'أخرى', color: '#78716c' },
];

if (!url) {
  describe.skip('backfillPersonalExpenseCategories (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await db.$disconnect();
    await store.disconnect();
  });

  async function personalProfile(tag: string, locale: 'en' | 'ar') {
    const { user, personalOrganization } = await store.users.create({
      email: `backfill-${tag}@me.ps`,
      displayName: 'Solo',
      passwordHash: 'x',
      locale,
      personal: { name: 'Personal', slug: `personal-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: new Date('2026-09-01T08:00:00Z'),
    });
    return { user, org: personalOrganization };
  }

  it('adds the three new categories, moves Projects expenses to Other, retires Projects, audited, and does nothing the second time', async () => {
    const tag = randomUUID().slice(0, 8);
    const at = new Date('2026-10-14T08:00:00Z');
    const { user, org } = await personalProfile(tag, 'en');
    await store.expenseCategories.seed(org.id, OLD_PERSONAL_PRESET_EN, at);
    const projects = (await store.expenseCategories.list(org.id, { includeArchived: false })).find((c) => c.name === 'Projects')!;
    const expense = await store.expenses.create({ organizationId: org.id, occurredOn: '2026-10-10', amountMinor: 5000n, currency: 'ILS', title: 'Side gig software', vendor: null, categoryId: projects.id, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at);

    const first = await backfillPersonalExpenseCategories(db, at);
    const line = first.organizations.find((l) => l.organizationId === org.id)!;
    expect(line.categoriesAdded.sort()).toEqual(['Communications & Internet', 'Health & Insurance', 'Shopping'].sort());
    expect(line.expensesReassignedFromProjects).toBe(1);
    expect(line.projectsArchived).toBe(true);

    const categories = await store.expenseCategories.list(org.id, { includeArchived: true });
    expect(categories.map((c) => c.name).sort()).toEqual(['Car', 'Communications & Internet', 'Gifts', 'Groceries', 'Health & Insurance', 'Investments', 'Leisure', 'Other', 'Projects', 'Rent', 'Shopping', 'Supplies', 'Transportation'].sort());
    const newOnes = categories.filter((c) => ['Shopping', 'Communications & Internet', 'Health & Insurance'].includes(c.name));
    expect(newOnes.every((c) => c.color?.match(/^#[0-9a-f]{6}$/))).toBe(true);
    const archivedProjects = categories.find((c) => c.name === 'Projects')!;
    expect(archivedProjects.archivedAt).not.toBeNull();
    const other = categories.find((c) => c.name === 'Other')!;
    expect((await store.expenses.getById(org.id, expense.id))?.categoryId).toBe(other.id);

    const audit = await db.auditEvent.findMany({ where: { organizationId: org.id, action: 'expense_category.updated' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ backfill: 'MAL-1137', reassignedExpenses: 1 });

    const second = await backfillPersonalExpenseCategories(db, at);
    const secondLine = second.organizations.find((l) => l.organizationId === org.id)!;
    expect(secondLine.categoriesAdded).toEqual([]);
    expect(secondLine.projectsArchived).toBe(false);
    expect(await db.expenseCategory.count({ where: { organizationId: org.id } })).toBe(13);
    expect(await db.auditEvent.count({ where: { organizationId: org.id, action: 'expense_category.updated' } })).toBe(1);
  });

  it('detects Arabic from the seeded preset, independent of the user’s current locale, and adds Arabic names', async () => {
    const tag = randomUUID().slice(0, 8);
    const at = new Date('2026-10-14T08:00:00Z');
    const { org } = await personalProfile(tag, 'ar');
    await store.expenseCategories.seed(org.id, OLD_PERSONAL_PRESET_AR, at);
    // The user's locale can drift after seeding; detection must read the categories, not this field.
    await db.user.update({ where: { id: org.personalOwnerUserId! }, data: { locale: 'en' } });

    const result = await backfillPersonalExpenseCategories(db, at);
    const line = result.organizations.find((l) => l.organizationId === org.id)!;
    expect(line.categoriesAdded.sort()).toEqual(['الاتصالات والإنترنت', 'التسوق', 'الصحة والتأمين'].sort());

    const categories = await store.expenseCategories.list(org.id, { includeArchived: true });
    expect(categories.find((c) => c.name === 'المشاريع')?.archivedAt).not.toBeNull();
  });

  it('leaves a profile already on the new preset untouched', async () => {
    const tag = randomUUID().slice(0, 8);
    const at = new Date('2026-10-14T08:00:00Z');
    const { org } = await personalProfile(tag, 'en');
    // Simulates a profile created after MAL-1137 shipped: seeded via the live presetFor(), no "Projects".
    await store.expenseCategories.seed(
      org.id,
      ['Groceries', 'Transportation', 'Car', 'Rent', 'Shopping', 'Communications & Internet', 'Health & Insurance', 'Investments', 'Leisure', 'Gifts', 'Supplies', 'Other'].map((name) => ({ name, color: '#78716c' })),
      at,
    );

    const result = await backfillPersonalExpenseCategories(db, at);
    const line = result.organizations.find((l) => l.organizationId === org.id)!;
    expect(line.categoriesAdded).toEqual([]);
    expect(line.projectsArchived).toBe(false);
    expect(line.expensesReassignedFromProjects).toBe(0);
    expect(await db.expenseCategory.count({ where: { organizationId: org.id } })).toBe(12);
  });

  it('leaves a never-seeded personal profile empty, so its first list still seeds the whole current preset', async () => {
    const tag = randomUUID().slice(0, 8);
    const at = new Date('2026-10-14T08:00:00Z');
    const { org } = await personalProfile(tag, 'en');

    const result = await backfillPersonalExpenseCategories(db, at);
    expect(result.organizations.find((l) => l.organizationId === org.id)).toBeUndefined();
    // Three categories here would make the route's "none yet → seed" check skip the preset for good.
    expect(await db.expenseCategory.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('writes nothing in dry mode but still reports what it would do', async () => {
    const tag = randomUUID().slice(0, 8);
    const at = new Date('2026-10-14T08:00:00Z');
    const { user, org } = await personalProfile(tag, 'en');
    await store.expenseCategories.seed(org.id, OLD_PERSONAL_PRESET_EN, at);
    const projects = (await store.expenseCategories.list(org.id, { includeArchived: false })).find((c) => c.name === 'Projects')!;
    await store.expenses.create({ organizationId: org.id, occurredOn: '2026-10-10', amountMinor: 1200n, currency: 'ILS', title: null, vendor: null, categoryId: projects.id, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at);

    const result = await backfillPersonalExpenseCategories(db, at, { dry: true });
    const line = result.organizations.find((l) => l.organizationId === org.id)!;
    expect(line.categoriesAdded.sort()).toEqual(['Communications & Internet', 'Health & Insurance', 'Shopping'].sort());
    expect(line.expensesReassignedFromProjects).toBe(1);
    expect(line.projectsArchived).toBe(true);

    expect(await db.expenseCategory.count({ where: { organizationId: org.id } })).toBe(10);
    expect(categoryNameKey('Projects')).toBe('projects');
    const stillProjects = await db.expenseCategory.findFirst({ where: { id: projects.id } });
    expect(stillProjects?.archivedAt).toBeNull();
  });

  it('never touches a non-personal organization', async () => {
    const tag = randomUUID().slice(0, 8);
    const at = new Date('2026-10-14T08:00:00Z');
    const firm = await store.organizations.create({ name: 'Firm', slug: `backfill-firm-${tag}`, defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' });
    await store.expenseCategories.seed(firm.id, [{ name: 'Office Rent', color: '#6366f1' }], at);

    const result = await backfillPersonalExpenseCategories(db, at);
    expect(result.organizations.find((l) => l.organizationId === firm.id)).toBeUndefined();
    expect(await db.expenseCategory.count({ where: { organizationId: firm.id } })).toBe(1);
  });
}
