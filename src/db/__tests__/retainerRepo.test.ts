import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { retainerRepo, projectedIncomeRepo, scheduleGenerator, retainerMatching, getRetainerSummary } from '../retainerRepository';

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
      const retainer = await db.retainerAgreements.add({
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

describe('retainerMatching', () => {
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

  describe('getSuggestionsForTransaction', () => {
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

      const suggestions = await retainerMatching.getSuggestionsForTransaction(txId);
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

      const suggestions = await retainerMatching.getSuggestionsForTransaction(txId);
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

      await retainerMatching.matchTransaction(dueItem!.id, txId);

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

      await retainerMatching.matchTransaction(dueItem!.id, txId);
      await retainerMatching.unmatchTransaction(dueItem!.id, txId);

      const updatedPi = await projectedIncomeRepo.get(dueItem!.id);
      expect(updatedPi?.matchedTransactionIds).not.toContain(txId);
      expect(updatedPi?.receivedAmountMinor).toBe(0);
      expect(updatedPi?.state).toBe('due');

      const updatedTx = await db.transactions.get(txId);
      expect(updatedTx?.linkedProjectedIncomeId).toBeUndefined();
    });
  });
});

describe('getRetainerSummary', () => {
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

    const summary = await getRetainerSummary(profileId);

    expect(summary.activeCount).toBe(2);
    expect(summary.totalExpectedMonthlyUsdMinor).toBe(100000);
    expect(summary.totalExpectedMonthlyIlsMinor).toBe(100000); // 300000/3
    expect(summary.totalDueUsdMinor).toBeGreaterThan(0);
    expect(summary.totalDueIlsMinor).toBeGreaterThan(0);
  });
});
