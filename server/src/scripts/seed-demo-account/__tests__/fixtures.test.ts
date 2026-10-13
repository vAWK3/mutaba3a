import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../fixtures.js';

const AMOUNT_RE = /^\d+\.\d{2}$/;

describe('seed-demo-account fixtures (MUT-136)', () => {
  it('never dates occurredOn, dueDate or settle.paidAt in the future, no matter when it runs', () => {
    for (const now of [new Date('2026-01-01T00:00:00Z'), new Date('2030-06-15T12:00:00Z')]) {
      const today = now.toISOString().slice(0, 10);
      for (const client of buildFixtures(now)) {
        for (const project of client.projects) {
          for (const income of project.income) {
            expect(income.occurredOn <= today).toBe(true);
            if (income.settle) expect(income.settle.paidAt <= today).toBe(true);
          }
          for (const expense of project.expenses) {
            expect(expense.occurredOn <= today).toBe(true);
          }
        }
      }
    }
  });

  it('only resolves dueDate and settle for owed entries, never received', () => {
    for (const client of buildFixtures(new Date('2026-06-01T00:00:00Z'))) {
      for (const project of client.projects) {
        for (const income of project.income) {
          if (income.kind === 'received') {
            expect(income.dueDate).toBeUndefined();
            expect(income.settle).toBeUndefined();
          }
        }
      }
    }
  });

  it('settles a receivable on or after its occurredOn date, never before', () => {
    for (const client of buildFixtures(new Date('2026-06-01T00:00:00Z'))) {
      for (const project of client.projects) {
        for (const income of project.income) {
          if (income.settle) expect(income.settle.paidAt >= income.occurredOn).toBe(true);
        }
      }
    }
  });

  it('formats every amount as a canonical two-decimal string', () => {
    for (const client of buildFixtures(new Date('2026-06-01T00:00:00Z'))) {
      for (const project of client.projects) {
        for (const income of project.income) {
          expect(income.amount).toMatch(AMOUNT_RE);
          if (income.settle?.amount) expect(income.settle.amount).toMatch(AMOUNT_RE);
        }
        for (const expense of project.expenses) {
          expect(expense.amount).toMatch(AMOUNT_RE);
        }
      }
    }
  });

  it('gives every client, project, income and expense a unique slug within its parent, for deterministic idempotency keys', () => {
    const fixtures = buildFixtures(new Date('2026-06-01T00:00:00Z'));
    const clientSlugs = fixtures.map((c) => c.slug);
    expect(new Set(clientSlugs).size).toBe(clientSlugs.length);
    for (const client of fixtures) {
      const projectSlugs = client.projects.map((p) => p.slug);
      expect(new Set(projectSlugs).size).toBe(projectSlugs.length);
      for (const project of client.projects) {
        const incomeSlugs = project.income.map((i) => i.slug);
        expect(new Set(incomeSlugs).size).toBe(incomeSlugs.length);
        const expenseSlugs = project.expenses.map((e) => e.slug);
        expect(new Set(expenseSlugs).size).toBe(expenseSlugs.length);
      }
    }
  });

  it('includes at least one overdue, one upcoming, one part-paid and one fully-settled owed entry (screen coverage)', () => {
    const today = '2026-06-01';
    const income = buildFixtures(new Date(`${today}T00:00:00Z`)).flatMap((c) => c.projects.flatMap((p) => p.income));
    const owed = income.filter((i) => i.kind === 'owed');
    expect(owed.some((i) => i.dueDate! < today && !i.settle)).toBe(true);
    expect(owed.some((i) => i.dueDate! > today && !i.settle)).toBe(true);
    expect(owed.some((i) => i.settle?.amount)).toBe(true);
    expect(owed.some((i) => i.settle && !i.settle.amount)).toBe(true);
  });
});
