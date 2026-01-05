import { db } from './database';
import type { Client, Project, Category, Transaction } from '../types';

const categories: Category[] = [
  { id: 'cat-1', kind: 'income', name: 'Development' },
  { id: 'cat-2', kind: 'income', name: 'Design' },
  { id: 'cat-3', kind: 'income', name: 'Consulting' },
  { id: 'cat-4', kind: 'income', name: 'Maintenance' },
  { id: 'cat-5', kind: 'expense', name: 'Software' },
  { id: 'cat-6', kind: 'expense', name: 'Hardware' },
  { id: 'cat-7', kind: 'expense', name: 'Services' },
  { id: 'cat-8', kind: 'expense', name: 'Travel' },
  { id: 'cat-9', kind: 'expense', name: 'Office' },
];

const clients: Client[] = [
  {
    id: 'client-1',
    name: 'Acme Corp',
    email: 'billing@acme.com',
    phone: '+1-555-0100',
    notes: 'Enterprise client, NET 30 payment terms',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'client-2',
    name: 'TechStart Ltd',
    email: 'finance@techstart.io',
    phone: '+1-555-0200',
    notes: 'Startup client, quick payment cycles',
    createdAt: '2024-02-01T09:00:00Z',
    updatedAt: '2024-02-01T09:00:00Z',
  },
  {
    id: 'client-3',
    name: 'Global Media Inc',
    email: 'accounts@globalmedia.com',
    phone: '+972-50-1234567',
    notes: 'Israeli client, prefers ILS billing',
    createdAt: '2024-03-10T11:00:00Z',
    updatedAt: '2024-03-10T11:00:00Z',
  },
  {
    id: 'client-4',
    name: 'LocalBiz',
    email: 'owner@localbiz.co.il',
    notes: 'Small business, monthly retainer',
    createdAt: '2024-04-20T08:00:00Z',
    updatedAt: '2024-04-20T08:00:00Z',
  },
];

const projects: Project[] = [
  {
    id: 'proj-1',
    name: 'Acme Website Redesign',
    clientId: 'client-1',
    field: 'Design',
    notes: 'Complete website overhaul',
    createdAt: '2024-01-20T10:00:00Z',
    updatedAt: '2024-01-20T10:00:00Z',
  },
  {
    id: 'proj-2',
    name: 'Acme Mobile App',
    clientId: 'client-1',
    field: 'Development',
    notes: 'iOS and Android app',
    createdAt: '2024-06-01T10:00:00Z',
    updatedAt: '2024-06-01T10:00:00Z',
  },
  {
    id: 'proj-3',
    name: 'TechStart MVP',
    clientId: 'client-2',
    field: 'Development',
    notes: 'Minimum viable product development',
    createdAt: '2024-02-15T09:00:00Z',
    updatedAt: '2024-02-15T09:00:00Z',
  },
  {
    id: 'proj-4',
    name: 'Global Media Campaign',
    clientId: 'client-3',
    field: 'Design',
    notes: 'Marketing campaign design',
    createdAt: '2024-03-15T11:00:00Z',
    updatedAt: '2024-03-15T11:00:00Z',
  },
  {
    id: 'proj-5',
    name: 'LocalBiz Monthly Support',
    clientId: 'client-4',
    field: 'Maintenance',
    notes: 'Ongoing maintenance and support',
    createdAt: '2024-05-01T08:00:00Z',
    updatedAt: '2024-05-01T08:00:00Z',
  },
];

// Generate transactions spanning the last few months
function generateTransactions(): Transaction[] {
  const transactions: Transaction[] = [];
  const now = new Date();

  // Helper to create dates
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  const daysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  // Paid income transactions
  transactions.push(
    {
      id: 'tx-1',
      kind: 'income',
      status: 'paid',
      title: 'Website Design Phase 1',
      clientId: 'client-1',
      projectId: 'proj-1',
      categoryId: 'cat-2',
      amountMinor: 500000, // $5,000
      currency: 'USD',
      occurredAt: daysAgo(45),
      paidAt: daysAgo(40),
      createdAt: daysAgo(45),
      updatedAt: daysAgo(40),
    },
    {
      id: 'tx-2',
      kind: 'income',
      status: 'paid',
      title: 'MVP Development Sprint 1',
      clientId: 'client-2',
      projectId: 'proj-3',
      categoryId: 'cat-1',
      amountMinor: 800000, // $8,000
      currency: 'USD',
      occurredAt: daysAgo(30),
      paidAt: daysAgo(25),
      createdAt: daysAgo(30),
      updatedAt: daysAgo(25),
    },
    {
      id: 'tx-3',
      kind: 'income',
      status: 'paid',
      title: 'Campaign Design',
      clientId: 'client-3',
      projectId: 'proj-4',
      categoryId: 'cat-2',
      amountMinor: 1500000, // 15,000 ILS
      currency: 'ILS',
      occurredAt: daysAgo(20),
      paidAt: daysAgo(15),
      createdAt: daysAgo(20),
      updatedAt: daysAgo(15),
    },
    {
      id: 'tx-4',
      kind: 'income',
      status: 'paid',
      title: 'Monthly Support - November',
      clientId: 'client-4',
      projectId: 'proj-5',
      categoryId: 'cat-4',
      amountMinor: 350000, // 3,500 ILS
      currency: 'ILS',
      occurredAt: daysAgo(35),
      paidAt: daysAgo(30),
      createdAt: daysAgo(35),
      updatedAt: daysAgo(30),
    },
    {
      id: 'tx-5',
      kind: 'income',
      status: 'paid',
      title: 'Monthly Support - December',
      clientId: 'client-4',
      projectId: 'proj-5',
      categoryId: 'cat-4',
      amountMinor: 350000, // 3,500 ILS
      currency: 'ILS',
      occurredAt: daysAgo(5),
      paidAt: daysAgo(3),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(3),
    }
  );

  // Unpaid income (receivables)
  transactions.push(
    {
      id: 'tx-6',
      kind: 'income',
      status: 'unpaid',
      title: 'Website Design Phase 2',
      clientId: 'client-1',
      projectId: 'proj-1',
      categoryId: 'cat-2',
      amountMinor: 500000, // $5,000
      currency: 'USD',
      occurredAt: daysAgo(10),
      dueDate: daysFromNow(-5), // Overdue
      createdAt: daysAgo(10),
      updatedAt: daysAgo(10),
    },
    {
      id: 'tx-7',
      kind: 'income',
      status: 'unpaid',
      title: 'MVP Development Sprint 2',
      clientId: 'client-2',
      projectId: 'proj-3',
      categoryId: 'cat-1',
      amountMinor: 800000, // $8,000
      currency: 'USD',
      occurredAt: daysAgo(7),
      dueDate: daysFromNow(3), // Due in 3 days
      createdAt: daysAgo(7),
      updatedAt: daysAgo(7),
    },
    {
      id: 'tx-8',
      kind: 'income',
      status: 'unpaid',
      title: 'Mobile App Phase 1',
      clientId: 'client-1',
      projectId: 'proj-2',
      categoryId: 'cat-1',
      amountMinor: 1200000, // $12,000
      currency: 'USD',
      occurredAt: daysAgo(3),
      dueDate: daysFromNow(27), // Due in 27 days
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    {
      id: 'tx-9',
      kind: 'income',
      status: 'unpaid',
      title: 'Campaign Phase 2',
      clientId: 'client-3',
      projectId: 'proj-4',
      categoryId: 'cat-2',
      amountMinor: 2000000, // 20,000 ILS
      currency: 'ILS',
      occurredAt: daysAgo(15),
      dueDate: daysFromNow(-10), // Overdue
      createdAt: daysAgo(15),
      updatedAt: daysAgo(15),
    }
  );

  // Expenses
  transactions.push(
    {
      id: 'tx-10',
      kind: 'expense',
      status: 'paid',
      title: 'Adobe Creative Cloud Annual',
      categoryId: 'cat-5',
      amountMinor: 59999, // $599.99
      currency: 'USD',
      occurredAt: daysAgo(60),
      paidAt: daysAgo(60),
      createdAt: daysAgo(60),
      updatedAt: daysAgo(60),
    },
    {
      id: 'tx-11',
      kind: 'expense',
      status: 'paid',
      title: 'New MacBook Pro',
      categoryId: 'cat-6',
      amountMinor: 249900, // $2,499
      currency: 'USD',
      occurredAt: daysAgo(90),
      paidAt: daysAgo(90),
      createdAt: daysAgo(90),
      updatedAt: daysAgo(90),
    },
    {
      id: 'tx-12',
      kind: 'expense',
      status: 'paid',
      title: 'AWS Hosting - November',
      categoryId: 'cat-7',
      amountMinor: 15000, // $150
      currency: 'USD',
      occurredAt: daysAgo(35),
      paidAt: daysAgo(35),
      createdAt: daysAgo(35),
      updatedAt: daysAgo(35),
    },
    {
      id: 'tx-13',
      kind: 'expense',
      status: 'paid',
      title: 'AWS Hosting - December',
      categoryId: 'cat-7',
      amountMinor: 18500, // $185
      currency: 'USD',
      occurredAt: daysAgo(5),
      paidAt: daysAgo(5),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    },
    {
      id: 'tx-14',
      kind: 'expense',
      status: 'paid',
      title: 'Office Supplies',
      categoryId: 'cat-9',
      amountMinor: 45000, // 450 ILS
      currency: 'ILS',
      occurredAt: daysAgo(20),
      paidAt: daysAgo(20),
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
    },
    {
      id: 'tx-15',
      kind: 'expense',
      status: 'paid',
      title: 'Client Meeting - Travel',
      clientId: 'client-3',
      projectId: 'proj-4',
      categoryId: 'cat-8',
      amountMinor: 85000, // 850 ILS
      currency: 'ILS',
      occurredAt: daysAgo(18),
      paidAt: daysAgo(18),
      notes: 'Travel to Tel Aviv for campaign kickoff meeting',
      createdAt: daysAgo(18),
      updatedAt: daysAgo(18),
    }
  );

  return transactions;
}

export async function seedDatabase(): Promise<void> {
  // Check if data already exists
  const existingClients = await db.clients.count();
  if (existingClients > 0) {
    console.log('Database already seeded');
    return;
  }

  console.log('Seeding database...');

  // Add categories
  await db.categories.bulkAdd(categories);

  // Add clients
  await db.clients.bulkAdd(clients);

  // Add projects
  await db.projects.bulkAdd(projects);

  // Add transactions
  const transactions = generateTransactions();
  await db.transactions.bulkAdd(transactions);

  // Add default settings
  await db.settings.put({
    id: 'default',
    enabledCurrencies: ['USD', 'ILS'],
    defaultCurrency: 'USD',
    defaultBaseCurrency: 'ILS',
  });

  console.log('Database seeded successfully');
}

export async function clearDatabase(): Promise<void> {
  await db.transactions.clear();
  await db.projects.clear();
  await db.clients.clear();
  await db.categories.clear();
  await db.fxRates.clear();
  await db.settings.clear();
  console.log('Database cleared');
}
