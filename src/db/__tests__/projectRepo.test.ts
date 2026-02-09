import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { clientRepo, projectRepo, transactionRepo, projectSummaryRepo } from '../repository';
import type { Project, Client } from '../../types';

describe('projectRepo', () => {
  let testClient: Client;

  beforeEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();

    // Create test client for relationship tests
    testClient = await clientRepo.create({ name: 'Test Client' });
  });

  afterEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
  });

  const createTestProject = (
    overrides: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> = {}
  ): Omit<Project, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: 'Test Project',
    clientId: testClient.id,
    field: 'Engineering',
    notes: 'Test notes',
    ...overrides,
  });

  describe('create', () => {
    it('should create a new project', async () => {
      const data = createTestProject();
      const project = await projectRepo.create(data);

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.clientId).toBe(testClient.id);
      expect(project.field).toBe('Engineering');
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it('should create project without client', async () => {
      const project = await projectRepo.create({
        name: 'Standalone Project',
        clientId: undefined,
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Standalone Project');
      expect(project.clientId).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return empty array when no projects exist', async () => {
      const projects = await projectRepo.list();
      expect(projects).toHaveLength(0);
    });

    it('should return all projects sorted by name', async () => {
      await projectRepo.create(createTestProject({ name: 'Zebra Project' }));
      await projectRepo.create(createTestProject({ name: 'Alpha Project' }));
      await projectRepo.create(createTestProject({ name: 'Beta Project' }));

      const projects = await projectRepo.list();

      expect(projects).toHaveLength(3);
      expect(projects[0].name).toBe('Alpha Project');
      expect(projects[1].name).toBe('Beta Project');
      expect(projects[2].name).toBe('Zebra Project');
    });

    it('should exclude archived projects by default', async () => {
      const active = await projectRepo.create(createTestProject({ name: 'Active' }));
      const toArchive = await projectRepo.create(createTestProject({ name: 'To Archive' }));
      await projectRepo.archive(toArchive.id);

      const projects = await projectRepo.list();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(active.id);
    });

    it('should include archived projects when requested', async () => {
      await projectRepo.create(createTestProject({ name: 'Active' }));
      const toArchive = await projectRepo.create(createTestProject({ name: 'To Archive' }));
      await projectRepo.archive(toArchive.id);

      const projects = await projectRepo.list({ includeArchived: true });

      expect(projects).toHaveLength(2);
    });

    it('should filter by clientId', async () => {
      const otherClient = await clientRepo.create({ name: 'Other Client' });

      await projectRepo.create(createTestProject({ name: 'Project A' }));
      await projectRepo.create(createTestProject({ name: 'Project B', clientId: otherClient.id }));

      const projects = await projectRepo.list({ clientId: testClient.id });

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Project A');
    });
  });

  describe('get', () => {
    it('should return a project by id', async () => {
      const created = await projectRepo.create(createTestProject());
      const fetched = await projectRepo.get(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.name).toBe(created.name);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await projectRepo.get('non-existent-id');
      expect(fetched).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update project fields', async () => {
      const project = await projectRepo.create(createTestProject());

      await projectRepo.update(project.id, { name: 'Updated Name', field: 'Design' });

      const updated = await projectRepo.get(project.id);
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.field).toBe('Design');
      // updatedAt should be set (may be same if test runs quickly, so just check it exists)
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should preserve unchanged fields', async () => {
      const project = await projectRepo.create(createTestProject());

      await projectRepo.update(project.id, { name: 'New Name' });

      const updated = await projectRepo.get(project.id);
      expect(updated?.clientId).toBe(testClient.id); // Unchanged
      expect(updated?.field).toBe('Engineering'); // Unchanged
    });
  });

  describe('archive', () => {
    it('should archive a project', async () => {
      const project = await projectRepo.create(createTestProject());

      await projectRepo.archive(project.id);

      const archived = await projectRepo.get(project.id);
      expect(archived?.archivedAt).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should permanently delete a project', async () => {
      const project = await projectRepo.create(createTestProject());

      await projectRepo.delete(project.id);

      const deleted = await projectRepo.get(project.id);
      expect(deleted).toBeUndefined();
    });
  });
});

describe('projectSummaryRepo', () => {
  let testClient: Client;

  beforeEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();

    testClient = await clientRepo.create({ name: 'Test Client' });
  });

  afterEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
  });

  describe('list', () => {
    it('should return project summaries with transaction totals', async () => {
      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: testClient.id,
        field: 'Engineering',
      });

      // Create transactions for this project
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        projectId: project.id,
        clientId: testClient.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-01-20',
        projectId: project.id,
        clientId: testClient.id,
      });
      await transactionRepo.create({
        kind: 'expense',
        status: 'paid',
        amountMinor: 2000,
        currency: 'USD',
        occurredAt: '2024-01-25',
        projectId: project.id,
      });

      const summaries = await projectSummaryRepo.list();

      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('Test Project');
      expect(summaries[0].clientName).toBe('Test Client');
      expect(summaries[0].paidIncomeMinor).toBe(10000);
      expect(summaries[0].unpaidIncomeMinor).toBe(5000);
      expect(summaries[0].expensesMinor).toBe(2000);
      expect(summaries[0].netMinor).toBe(8000); // 10000 - 2000
    });

    it('should filter by currency', async () => {
      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: testClient.id,
      });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 20000,
        currency: 'ILS',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });

      const summaries = await projectSummaryRepo.list({ currency: 'USD' });

      expect(summaries[0].paidIncomeMinor).toBe(10000);
    });

    it('should filter by field', async () => {
      await projectRepo.create({ name: 'Engineering Project', field: 'Engineering' });
      await projectRepo.create({ name: 'Design Project', field: 'Design' });

      const summaries = await projectSummaryRepo.list({ field: 'Engineering' });

      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('Engineering Project');
    });

    it('should filter by search term', async () => {
      await projectRepo.create({ name: 'Website Redesign', clientId: testClient.id });
      await projectRepo.create({ name: 'Mobile App' });

      const summaries = await projectSummaryRepo.list({ search: 'website' });

      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('Website Redesign');
    });

    it('should search by client name', async () => {
      await projectRepo.create({ name: 'Project A', clientId: testClient.id });
      const otherClient = await clientRepo.create({ name: 'Acme Corp' });
      await projectRepo.create({ name: 'Project B', clientId: otherClient.id });

      const summaries = await projectSummaryRepo.list({ search: 'Test Client' });

      expect(summaries).toHaveLength(1);
      expect(summaries[0].clientName).toBe('Test Client');
    });

    it('should include per-currency breakdown when no currency filter', async () => {
      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: testClient.id,
      });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 20000,
        currency: 'ILS',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });
      await transactionRepo.create({
        kind: 'expense',
        status: 'paid',
        amountMinor: 5000,
        currency: 'EUR',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });

      const summaries = await projectSummaryRepo.list();

      expect(summaries[0].paidIncomeMinorUSD).toBe(10000);
      expect(summaries[0].paidIncomeMinorILS).toBe(20000);
      expect(summaries[0].expensesMinorEUR).toBe(5000);
    });

    it('should sort by last activity date', async () => {
      const project1 = await projectRepo.create({ name: 'Project 1' });
      const project2 = await projectRepo.create({ name: 'Project 2' });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-01',
        projectId: project1.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-02-01',
        projectId: project2.id,
      });

      const summaries = await projectSummaryRepo.list();

      // Most recent activity first
      expect(summaries[0].name).toBe('Project 2');
      expect(summaries[1].name).toBe('Project 1');
    });
  });

  describe('get', () => {
    it('should return a single project summary', async () => {
      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: testClient.id,
        field: 'Engineering',
      });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });

      const summary = await projectSummaryRepo.get(project.id);

      expect(summary).toBeDefined();
      expect(summary?.name).toBe('Test Project');
      expect(summary?.clientName).toBe('Test Client');
      expect(summary?.field).toBe('Engineering');
      expect(summary?.paidIncomeMinor).toBe(10000);
    });

    it('should return undefined for non-existent project', async () => {
      const summary = await projectSummaryRepo.get('non-existent-id');
      expect(summary).toBeUndefined();
    });

    it('should filter by date range', async () => {
      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: testClient.id,
      });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        projectId: project.id,
      });

      const summary = await projectSummaryRepo.get(project.id, {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(summary?.paidIncomeMinor).toBe(10000);
    });

    it('should include per-currency breakdown when no currency filter', async () => {
      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: testClient.id,
      });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 20000,
        currency: 'ILS',
        occurredAt: '2024-01-15',
        projectId: project.id,
      });

      const summary = await projectSummaryRepo.get(project.id);

      expect(summary?.paidIncomeMinorUSD).toBe(10000);
      expect(summary?.unpaidIncomeMinorILS).toBe(20000);
    });
  });
});
