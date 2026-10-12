import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getRepositories,
  setRepositories,
  resetRepositories,
  type Repositories,
} from '../provider';
import { transactionRepo, clientRepo, settingsRepo, paymentRecordRepo, businessProfileRepo } from '../repository';
import { expenseRepo } from '../expenseRepository';
import { retainerRepo, projectedIncomeRepo } from '../retainerRepository';

afterEach(() => {
  resetRepositories();
  vi.unstubAllEnvs();
});

describe('repository provider', () => {
  describe('default resolution', () => {
    it('resolves the Dexie repositories when nothing was injected', () => {
      const repos = getRepositories();

      expect(repos.base.transactions).toBe(transactionRepo);
      expect(repos.base.clients).toBe(clientRepo);
      expect(repos.base.settings).toBe(settingsRepo);
      expect(repos.base.expenses).toBe(expenseRepo);
      expect(repos.base.retainerAgreements).toBe(retainerRepo);
      expect(repos.base.projectedIncome).toBe(projectedIncomeRepo);
    });

    it('exposes only the base repositories, now that device sync is retired (MUT-73)', () => {
      const repos = getRepositories();

      expect(Object.keys(repos)).toEqual(['base']);
      // The mutations that used to capture a sync op now resolve to the plain
      // repositories, so they write exactly what the repository writes.
      expect(repos.base.transactions).toBe(transactionRepo);
      expect(repos.base.paymentRecords).toBe(paymentRecordRepo);
      expect(repos.base.businessProfiles).toBe(businessProfileRepo);
    });

    it('fills every declared slot', () => {
      const repos = getRepositories();

      for (const [slot, repo] of Object.entries(repos.base)) {
        expect(repo, `base.${slot} is unset`).toBeDefined();
      }
    });
  });

  describe('reference stability', () => {
    it('returns the same object on every call', () => {
      // Callers put this in query keys and useMemo dependencies. A fresh
      // object per call would churn every dependent render.
      expect(getRepositories()).toBe(getRepositories());
    });

    it('keeps the same reference across unrelated reads', () => {
      const first = getRepositories();
      void getRepositories().base.clients;
      expect(getRepositories()).toBe(first);
    });
  });

  describe('injection', () => {
    it('returns the injected registry after setRepositories', () => {
      const previous = getRepositories();
      const stub = {
        base: { ...previous.base },
      } as Repositories;

      setRepositories(stub);

      expect(getRepositories()).toBe(stub);
      expect(getRepositories()).not.toBe(previous);
    });

    it('restores the Dexie default on reset', () => {
      const original = getRepositories();
      setRepositories({
        base: { ...original.base },
      } as Repositories);

      resetRepositories();

      expect(getRepositories()).toBe(original);
      expect(getRepositories().base.transactions).toBe(transactionRepo);
    });

    it('refuses injection in a production build', () => {
      vi.stubEnv('PROD', true);
      const current = getRepositories();

      expect(() =>
        setRepositories({ base: { ...current.base } } as Repositories)
      ).toThrow(/not available in production/);

      expect(getRepositories()).toBe(current);
    });
  });
});
