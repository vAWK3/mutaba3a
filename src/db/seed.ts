import { db } from './database';

/**
 * Initialize the database with default settings if not already present.
 * Does NOT seed any sample data - fresh installs start empty.
 */
export async function initDatabase(): Promise<void> {
  const existingSettings = await db.settings.get('default');
  if (!existingSettings) {
    await db.settings.put({
      id: 'default',
      enabledCurrencies: ['USD', 'ILS'],
      defaultCurrency: 'USD',
      defaultBaseCurrency: 'ILS',
    });
    console.log('Database initialized with default settings');
  }
}

/**
 * Clear all data tables except settings.
 * Settings are preserved to maintain user preferences.
 */
export async function deleteAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.transactions, db.projects, db.clients, db.categories, db.fxRates],
    async () => {
      await db.transactions.clear();
      await db.projects.clear();
      await db.clients.clear();
      await db.categories.clear();
      await db.fxRates.clear();
      // Settings are intentionally preserved (user preference)
    }
  );
  console.log('All data deleted (settings preserved)');
}

/**
 * Clear all tables including settings.
 * Used for import functionality to ensure clean slate.
 */
export async function clearDatabase(): Promise<void> {
  await db.transactions.clear();
  await db.projects.clear();
  await db.clients.clear();
  await db.categories.clear();
  await db.fxRates.clear();
  await db.settings.clear();
  console.log('Database cleared');
}
