import type { Settings } from '../types';

/**
 * The one default settings row. Used by `settingsRepo.get()` when no row
 * exists, by `initDatabase()` on first run, and by the feature reconcile
 * when it must create the row. Kept in its own module (no imports besides
 * types) so `database.ts → features.ts → here` never cycles back into the
 * repositories.
 */
const defaults: Settings = {
  id: 'default',
  enabledCurrencies: ['USD', 'ILS'],
  defaultCurrency: 'USD',
  defaultBaseCurrency: 'ILS',
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze(defaults);
