import Dexie, { type Table } from 'dexie';
import type { Client, Project, Category, Transaction, FxRate, Settings } from '../types';

export class MiniCrmDatabase extends Dexie {
  clients!: Table<Client, string>;
  projects!: Table<Project, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  fxRates!: Table<FxRate, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('mutaba3a');

    this.version(1).stores({
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt',
      fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt',
      settings: 'id',
    });
  }
}

export const db = new MiniCrmDatabase();
