import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { retainerRepo, projectedIncomeRepo, scheduleGenerator } from '../retainerRepository';
import { getRepositories } from '../provider';
import { atInstantIn } from '../../test/atInstantIn';

describe('retainerRepo', () => {
  const profileId = 'test-profile-1';
  const clientId = 'test-client-1';

  beforeEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      email: 'test@example.com',
      isDefault: true,
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.clients.add({
      id: clientId,
      name: 'Test Client',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();
  });

  describe('create', () => {
    it('should create a draft retainer without generating schedule', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Monthly Retainer',
        amountMinor: 100000, // $1000
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'draft',
      });

      expect(retainer.id).toBeDefined();
      expect(retainer.title).toBe('Monthly Retainer');
      expect(retainer.status).toBe('draft');

      // Draft retainers don't generate schedule
      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      expect(schedule).toHaveLength(0);
    });

    it('should create an active retainer and generate schedule', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Monthly Retainer',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      expect(retainer.status).toBe('active');

      // Active retainers generate schedule
      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      expect(schedule.length).toBeGreaterThan(0);
    });
  });

  describe('get', () => {
    it('should return a retainer by id', async () => {
      const created = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test Retainer',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'draft',
      });

      const fetched = await retainerRepo.get(created.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await retainerRepo.get('non-existent');
      expect(fetched).toBeUndefined();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await retainerRepo.create({
        profileId,
        clientId,
        title: 'Retainer 1',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'draft',
      });

      await retainerRepo.create({
        profileId,
        clientId,
        title: 'Retainer 2',
        amountMinor: 50000,
        currency: 'ILS',
        cadence: 'quarterly',
        paymentDay: 1,
        startDate: '2024-01-01',
        status: 'active',
      });
    });

    it('should return all non-archived retainers', async () => {
      const retainers = await retainerRepo.list();
      expect(retainers).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const drafts = await retainerRepo.list({ status: 'draft' });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].title).toBe('Retainer 1');

      const active = await retainerRepo.list({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe('Retainer 2');
    });

    it('should filter by currency', async () => {
      const usdRetainers = await retainerRepo.list({ currency: 'USD' });
      expect(usdRetainers).toHaveLength(1);
      expect(usdRetainers[0].currency).toBe('USD');
    });

    it('should search by title', async () => {
      const results = await retainerRepo.list({ search: 'Retainer 2' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Retainer 2');
    });

    it('should enrich with client name', async () => {
      const retainers = await retainerRepo.list();
      expect(retainers[0].clientName).toBe('Test Client');
    });
  });

  describe('update', () => {
    it('should update retainer fields', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'draft',
      });

      await retainerRepo.update(retainer.id, { title: 'Updated', amountMinor: 200000 });

      const updated = await retainerRepo.get(retainer.id);
      expect(updated?.title).toBe('Updated');
      expect(updated?.amountMinor).toBe(200000);
    });
  });

  describe('archive', () => {
    it('should archive a retainer', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      await retainerRepo.archive(retainer.id);

      const archived = await retainerRepo.get(retainer.id);
      expect(archived?.archivedAt).toBeDefined();

      // Should not appear in list
      const retainers = await retainerRepo.list();
      expect(retainers).toHaveLength(0);
    });
  });

  describe('activate', () => {
    it('should activate a draft retainer and generate schedule', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'draft',
      });

      expect((await projectedIncomeRepo.getByRetainer(retainer.id))).toHaveLength(0);

      await retainerRepo.activate(retainer.id);

      const activated = await retainerRepo.get(retainer.id);
      expect(activated?.status).toBe('active');

      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      expect(schedule.length).toBeGreaterThan(0);
    });
  });

  describe('pause', () => {
    it('should pause an active retainer and cancel upcoming items', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      await retainerRepo.pause(retainer.id);

      const paused = await retainerRepo.get(retainer.id);
      expect(paused?.status).toBe('paused');

      // Upcoming items should be canceled
      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      const upcomingItems = schedule.filter(pi => pi.state === 'upcoming');
      expect(upcomingItems).toHaveLength(0);
    });
  });

  describe('resume', () => {
    it('should resume a paused retainer and regenerate schedule', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      await retainerRepo.pause(retainer.id);
      await retainerRepo.resume(retainer.id);

      const resumed = await retainerRepo.get(retainer.id);
      expect(resumed?.status).toBe('active');

      // Schedule should be regenerated
      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      expect(schedule.length).toBeGreaterThan(0);
    });
  });

  describe('end', () => {
    it('should end an active retainer', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      await retainerRepo.end(retainer.id);

      const ended = await retainerRepo.get(retainer.id);
      expect(ended?.status).toBe('ended');
      expect(ended?.endDate).toBeDefined();
    });
  });
});

describe('projectedIncomeRepo', () => {
  const profileId = 'test-profile-1';
  const clientId = 'test-client-1';

  beforeEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      email: 'test@example.com',
      isDefault: true,
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.clients.add({
      id: clientId,
      name: 'Test Client',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  describe('list', () => {
    it('should filter by state', async () => {
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      // Should have both due (past) and upcoming items
      const allItems = await projectedIncomeRepo.getByRetainer(retainer.id);
      expect(allItems.length).toBeGreaterThan(0);
    });

    it('should filter by currency', async () => {
      await retainerRepo.create({
        profileId,
        clientId,
        title: 'USD Retainer',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      await retainerRepo.create({
        profileId,
        clientId,
        title: 'ILS Retainer',
        amountMinor: 50000,
        currency: 'ILS',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
      });

      const usdItems = await projectedIncomeRepo.list({ currency: 'USD' });
      expect(usdItems.every(pi => pi.currency === 'USD')).toBe(true);
    });
  });

  describe('getDueItems', () => {
    it('should return only due items', async () => {
      await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2020-01-01', // Far in the past to ensure due items
        status: 'active',
      });

      const dueItems = await projectedIncomeRepo.getDueItems();
      expect(dueItems.every(pi => pi.state === 'due')).toBe(true);
    });
  });
});

describe('scheduleGenerator', () => {
  const profileId = 'test-profile-1';
  const clientId = 'test-client-1';

  beforeEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      email: 'test@example.com',
      isDefault: true,
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.clients.add({
      id: clientId,
      name: 'Test Client',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  describe('generateSchedule', () => {
    it('should generate monthly schedule items', async () => {
      await db.retainerAgreements.add({
        id: 'test-retainer',
        profileId,
        clientId,
        title: 'Monthly Retainer',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await scheduleGenerator.generateSchedule('test-retainer');

      const schedule = await projectedIncomeRepo.getByRetainer('test-retainer');
      expect(schedule.length).toBeGreaterThan(0);

      // Each item should have correct period
      for (const item of schedule) {
        expect(item.expectedAmountMinor).toBe(100000);
        expect(item.currency).toBe('USD');
        expect(item.periodStart).toBeDefined();
        expect(item.periodEnd).toBeDefined();
      }
    });

    it('should generate quarterly schedule items', async () => {
      await db.retainerAgreements.add({
        id: 'test-retainer-q',
        profileId,
        clientId,
        title: 'Quarterly Retainer',
        amountMinor: 300000,
        currency: 'USD',
        cadence: 'quarterly',
        paymentDay: 1,
        startDate: '2024-01-01',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await scheduleGenerator.generateSchedule('test-retainer-q');

      const schedule = await projectedIncomeRepo.getByRetainer('test-retainer-q');
      expect(schedule.length).toBeGreaterThan(0);
    });

    it('should be idempotent - not create duplicate items', async () => {
      await db.retainerAgreements.add({
        id: 'test-retainer-idem',
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2024-01-01',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await scheduleGenerator.generateSchedule('test-retainer-idem');
      const firstRun = await projectedIncomeRepo.getByRetainer('test-retainer-idem');

      await scheduleGenerator.generateSchedule('test-retainer-idem');
      const secondRun = await projectedIncomeRepo.getByRetainer('test-retainer-idem');

      expect(secondRun.length).toBe(firstRun.length);
    });
  });
});

describe('projectedIncome matching', () => {
  const profileId = 'test-profile-1';
  const clientId = 'test-client-1';

  beforeEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      email: 'test@example.com',
      isDefault: true,
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.clients.add({
      id: clientId,
      name: 'Test Client',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  describe('getMatchSuggestions', () => {
    it('should return suggestions for matching income transactions', async () => {
      // Create a retainer with due items
      await retainerRepo.create({
        profileId,
        clientId,
        title: 'Monthly Retainer',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2020-01-01', // Far past to have due items
        status: 'active',
      });

      // Create a paid income transaction
      const txId = crypto.randomUUID();
      await db.transactions.add({
        id: txId,
        kind: 'income',
        status: 'paid',
        amountMinor: 100000,
        currency: 'USD',
        clientId,
        occurredAt: '2024-03-15',
        paidAt: '2024-03-15',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const suggestions = await getRepositories().base.projectedIncome.getMatchSuggestions(txId);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].confidence).toBeDefined();
      expect(suggestions[0].scoreBreakdown).toBeDefined();
    });

    it('should not return suggestions for expense transactions', async () => {
      const txId = crypto.randomUUID();
      await db.transactions.add({
        id: txId,
        kind: 'expense',
        status: 'paid',
        amountMinor: 50000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const suggestions = await getRepositories().base.projectedIncome.getMatchSuggestions(txId);
      expect(suggestions).toHaveLength(0);
    });
  });

  describe('matchTransaction', () => {
    it('should link a transaction to projected income', async () => {
      // Create retainer with due items
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2020-01-01',
        status: 'active',
      });

      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      const dueItem = schedule.find(pi => pi.state === 'due');
      expect(dueItem).toBeDefined();

      // Create and match transaction
      const txId = crypto.randomUUID();
      await db.transactions.add({
        id: txId,
        kind: 'income',
        status: 'paid',
        amountMinor: 100000,
        currency: 'USD',
        clientId,
        occurredAt: '2024-03-15',
        paidAt: '2024-03-15',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await getRepositories().base.projectedIncome.match(dueItem!.id, txId);

      // Check projected income was updated
      const updatedPi = await projectedIncomeRepo.get(dueItem!.id);
      expect(updatedPi?.matchedTransactionIds).toContain(txId);
      expect(updatedPi?.receivedAmountMinor).toBe(100000);
      expect(updatedPi?.state).toBe('received');

      // Check transaction was linked
      const updatedTx = await db.transactions.get(txId);
      expect(updatedTx?.linkedProjectedIncomeId).toBe(dueItem!.id);
    });
  });

  describe('unmatchTransaction', () => {
    it('should unlink a transaction from projected income', async () => {
      // Create retainer with due items
      const retainer = await retainerRepo.create({
        profileId,
        clientId,
        title: 'Test',
        amountMinor: 100000,
        currency: 'USD',
        cadence: 'monthly',
        paymentDay: 15,
        startDate: '2020-01-01',
        status: 'active',
      });

      const schedule = await projectedIncomeRepo.getByRetainer(retainer.id);
      const dueItem = schedule.find(pi => pi.state === 'due');

      const txId = crypto.randomUUID();
      await db.transactions.add({
        id: txId,
        kind: 'income',
        status: 'paid',
        amountMinor: 100000,
        currency: 'USD',
        clientId,
        occurredAt: '2024-03-15',
        paidAt: '2024-03-15',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await getRepositories().base.projectedIncome.match(dueItem!.id, txId);
      await getRepositories().base.projectedIncome.unmatch(dueItem!.id, txId);

      const updatedPi = await projectedIncomeRepo.get(dueItem!.id);
      expect(updatedPi?.matchedTransactionIds).not.toContain(txId);
      expect(updatedPi?.receivedAmountMinor).toBe(0);
      expect(updatedPi?.state).toBe('due');

      const updatedTx = await db.transactions.get(txId);
      expect(updatedTx?.linkedProjectedIncomeId).toBeUndefined();
    });
  });
});

describe('retainerAgreements.getSummary', () => {
  const profileId = 'test-profile-1';
  const clientId = 'test-client-1';

  beforeEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      email: 'test@example.com',
      isDefault: true,
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.clients.add({
      id: clientId,
      name: 'Test Client',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  it('should calculate retainer summary', async () => {
    await retainerRepo.create({
      profileId,
      clientId,
      title: 'USD Retainer',
      amountMinor: 100000, // $1000/month
      currency: 'USD',
      cadence: 'monthly',
      paymentDay: 15,
      startDate: '2020-01-01',
      status: 'active',
    });

    await retainerRepo.create({
      profileId,
      clientId,
      title: 'ILS Retainer',
      amountMinor: 300000, // 3000 ILS/quarter = 1000/month
      currency: 'ILS',
      cadence: 'quarterly',
      paymentDay: 1,
      startDate: '2020-01-01',
      status: 'active',
    });

    const summary = await getRepositories().base.retainerAgreements.getSummary(profileId);

    expect(summary.activeCount).toBe(2);
    expect(summary.totalExpectedMonthlyUsdMinor).toBe(100000);
    expect(summary.totalExpectedMonthlyIlsMinor).toBe(100000); // 300000/3
    expect(summary.totalDueUsdMinor).toBeGreaterThan(0);
    expect(summary.totalDueIlsMinor).toBeGreaterThan(0);
  });
});

// MUT-47 (T2): paths with no test before the helpers moved into the
// repository contracts. Written against today's behaviour, kept across the move.
describe('retainer state helpers (characterization, MUT-47)', () => {
  // 01:30 on 2026-10-14 in Asia/Jerusalem (UTC+3) is still 2026-10-13 in UTC,
  // so a UTC "today" is a day behind here (ADR-022, TD-014).
  const LOCAL_TODAY = '2026-10-14';
  const atJerusalemSmallHours = (fn: () => Promise<unknown>) =>
    atInstantIn('Asia/Jerusalem', '2026-10-13T22:30:00.000Z', async () => {
      await fn();
    });
  const profileId = 'test-profile-1';
  const clientId = 'test-client-1';
  const now = () => new Date().toISOString();

  async function clearAll() {
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  }

  function projected(id: string, state: 'upcoming' | 'due' | 'received', expectedDate: string) {
    return {
      id,
      profileId,
      sourceType: 'retainer' as const,
      sourceId: 'ret-x',
      clientId,
      currency: 'USD' as const,
      expectedAmountMinor: 100000,
      expectedDate,
      periodStart: expectedDate,
      periodEnd: expectedDate,
      state,
      receivedAmountMinor: 0,
      matchedTransactionIds: [],
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
  }

  beforeEach(async () => {
    await clearAll();
    await db.clients.add({ id: clientId, name: 'Test Client', createdAt: now(), updatedAt: now() });
  });

  afterEach(clearAll);

  it('refreshes due states: only upcoming rows dated today or earlier become due', async () => {
    await db.projectedIncome.bulkAdd([
      projected('pi-past', 'upcoming', '2020-01-15'),
      projected('pi-today', 'upcoming', LOCAL_TODAY),
      projected('pi-future', 'upcoming', '2026-10-15'),
      projected('pi-received', 'received', '2020-01-15'),
    ]);

    await atJerusalemSmallHours(() => getRepositories().base.projectedIncome.refreshDueStates());

    expect((await db.projectedIncome.get('pi-past'))?.state).toBe('due');
    expect((await db.projectedIncome.get('pi-today'))?.state).toBe('due');
    expect((await db.projectedIncome.get('pi-future'))?.state).toBe('upcoming');
    expect((await db.projectedIncome.get('pi-received'))?.state).toBe('received');
    expect((await db.projectedIncome.get('pi-past'))?.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('marks a projected row missed and stamps updatedAt', async () => {
    await db.projectedIncome.add(projected('pi-1', 'due', '2020-01-15'));

    await getRepositories().base.projectedIncome.markMissed('pi-1');

    const row = await db.projectedIncome.get('pi-1');
    expect(row?.state).toBe('missed');
    expect(row?.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('suggests matches only for paid, unlinked, live income', async () => {
    await getRepositories().base.retainerAgreements.create({
      profileId,
      clientId,
      title: 'Monthly',
      amountMinor: 100000,
      currency: 'USD',
      cadence: 'monthly',
      paymentDay: 15,
      startDate: '2020-01-01',
      status: 'active',
    });
    const base = { kind: 'income' as const, amountMinor: 100000, currency: 'USD' as const, clientId, occurredAt: '2024-03-15', createdAt: now(), updatedAt: now() };
    await db.transactions.bulkAdd([
      { ...base, id: 'tx-paid', status: 'paid', paidAt: '2024-03-15' },
      { ...base, id: 'tx-unpaid', status: 'unpaid' },
      { ...base, id: 'tx-linked', status: 'paid', paidAt: '2024-03-15', linkedProjectedIncomeId: 'pi-somewhere' },
      { ...base, id: 'tx-deleted', status: 'paid', paidAt: '2024-03-15', deletedAt: now() },
    ]);

    const results = await getRepositories().base.projectedIncome.getAllMatchSuggestions();

    expect(results.map((r) => r.transaction.id)).toEqual(['tx-paid']);
    expect(results[0].transaction.clientName).toBe('Test Client');
    expect(results[0].suggestions.length).toBeGreaterThan(0);
  });

  it('regenerating a schedule keeps received rows and drops upcoming ones', async () => {
    const retainer = await getRepositories().base.retainerAgreements.create({
      profileId,
      clientId,
      title: 'Monthly',
      amountMinor: 100000,
      currency: 'USD',
      cadence: 'monthly',
      paymentDay: 15,
      startDate: '2020-01-01',
      status: 'active',
    });
    const before = await db.projectedIncome.where('sourceId').equals(retainer.id).toArray();
    const received = before.find((pi) => pi.state === 'due')!;
    await db.projectedIncome.update(received.id, { state: 'received', receivedAmountMinor: 100000 });
    const upcomingIds = before.filter((pi) => pi.state === 'upcoming').map((pi) => pi.id);

    await getRepositories().base.retainerAgreements.update(retainer.id, { amountMinor: 120000 });

    const after = await db.projectedIncome.where('sourceId').equals(retainer.id).toArray();
    expect(after.find((pi) => pi.id === received.id)?.state).toBe('received');
    expect(after.some((pi) => upcomingIds.includes(pi.id))).toBe(false);
    expect(after.filter((pi) => pi.state === 'upcoming').every((pi) => pi.expectedAmountMinor === 120000)).toBe(true);
  });

  describe('"today" is the local calendar day, not the UTC one', () => {
    const retainerInput = {
      profileId,
      clientId,
      title: 'Monthly',
      amountMinor: 100000,
      currency: 'USD' as const,
      cadence: 'monthly' as const,
      paymentDay: 14,
      startDate: '2026-10-01',
    };

    it('end() stamps the local date as the end date', async () => {
      await atJerusalemSmallHours(async () => {
        const retainer = await getRepositories().base.retainerAgreements.create({ ...retainerInput, status: 'active' });
        await getRepositories().base.retainerAgreements.end(retainer.id);
        expect((await db.retainerAgreements.get(retainer.id))?.endDate).toBe(LOCAL_TODAY);
      });
    });

    it('a generated row expected today is born due', async () => {
      await atJerusalemSmallHours(async () => {
        const retainer = await getRepositories().base.retainerAgreements.create({ ...retainerInput, status: 'active' });
        const rows = await db.projectedIncome.where('sourceId').equals(retainer.id).toArray();
        expect(rows.find((pi) => pi.expectedDate === LOCAL_TODAY)?.state).toBe('due');
      });
    });

    it('the schedule horizon is twelve months from the local date', async () => {
      await atJerusalemSmallHours(async () => {
        const retainer = await getRepositories().base.retainerAgreements.create({
          ...retainerInput,
          startDate: LOCAL_TODAY,
          status: 'active',
        });
        const rows = await db.projectedIncome.where('sourceId').equals(retainer.id).toArray();
        expect(rows.map((pi) => pi.periodStart)).toContain('2027-10-01');
      });
    });

    it('unmatching the only payment of a row expected today puts it back to due', async () => {
      await db.projectedIncome.add(projected('pi-today', 'upcoming', LOCAL_TODAY));
      await db.transactions.add({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 100000,
        currency: 'USD',
        clientId,
        occurredAt: '2026-10-13',
        paidAt: '2026-10-13',
        createdAt: now(),
        updatedAt: now(),
      });
      await getRepositories().base.projectedIncome.match('pi-today', 'tx-1');

      await atJerusalemSmallHours(() => getRepositories().base.projectedIncome.unmatch('pi-today', 'tx-1'));

      expect((await db.projectedIncome.get('pi-today'))?.state).toBe('due');
    });

    it('a due row expected yesterday is overdue by one day and counts as overdue', async () => {
      await db.projectedIncome.add(projected('pi-yesterday', 'due', '2026-10-13'));

      await atJerusalemSmallHours(async () => {
        const [row] = await getRepositories().base.projectedIncome.list({ state: 'due' });
        expect(row.daysOverdue).toBe(1);
        const summary = await getRepositories().base.retainerAgreements.getSummary();
        expect(summary.totalOverdueUsdMinor).toBe(100000);
      });
    });
  });
});
