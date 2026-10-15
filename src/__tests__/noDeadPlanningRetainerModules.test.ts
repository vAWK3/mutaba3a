import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FEATURE_KEYS, FEATURE_DATA_PROBES } from '../lib/features/features';

/**
 * MUT-226 guard: Financial Planning and the local (Dexie) Retainers area are
 * retired, and v24 drops their tables. A partial revert must not bring back a
 * module, a drawer, a switch or a reference to a dropped table. The server's
 * Money v1 retainers are a different feature: the hosted portal (src/hosted)
 * still reads `RETAINER_CHARGE` receivables and stays out of this sweep.
 */
const ROOT = join(__dirname, '..');
const GONE = [
  'pages/planning',
  'pages/retainers',
  'components/drawers/PlanAssumptionDrawer.tsx',
  'components/drawers/PlanAssumptionDrawer.css',
  'components/drawers/RetainerDrawer.tsx',
  'components/drawers/RetainerMatchingDrawer.tsx',
  'components/clients/ClientRetainersCard.tsx',
  'services/planCalculationService.ts',
  'db/planRepository.ts',
  'db/retainerRepository.ts',
  'hooks/usePlanQueries.ts',
  'hooks/useRetainerQueries.ts',
  'demo/seedData/retainers.ts',
  'demo/seedData/projectedIncome.ts',
];
const DELETED_NAMES =
  /planRepo|planAssumptionRepo|planScenarioRepo|usePlanQueries|planCalculationService|PlanAssumptionDrawer|retainerRepo|projectedIncomeRepo|useRetainerQueries|RetainerDrawer|RetainerMatchingDrawer|ClientRetainersCard|linkedProjectedIncomeId|PlanningIcon|RetainerIcon/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'hosted' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe('planning and local retainers after MUT-226', () => {
  it.each(GONE)('%s no longer exists', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(false);
  });

  it('no app source references a deleted module', () => {
    const offenders = sourceFiles(ROOT)
      .filter((path) => !path.endsWith('db/database.ts'))
      .filter((path) => DELETED_NAMES.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it('the optional areas are expenses, insights, projects and conversions only', () => {
    expect([...FEATURE_KEYS]).toEqual(['expenses', 'insights', 'projects', 'conversions']);
    expect(Object.keys(FEATURE_DATA_PROBES).sort()).toEqual(['conversions', 'expenses', 'insights', 'projects']);
  });

  const RETIRED_KEYS = [
    'planning',
    'retainers',
    'retainerMatching',
    'drawer.retainer',
    'nav.planning',
    'nav.retainers',
    'clients.detail.retainers',
    'settings.features.items.planning',
    'settings.features.items.retainers',
    'demo.modal.item.retainers',
    'insights.toggles.includeProjected',
  ];
  const lookup = (json: unknown, path: string) =>
    path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), json);

  it.each(['en', 'ar'])('the %s locale carries no planning or retainer copy', (locale) => {
    const json = JSON.parse(readFileSync(join(ROOT, `lib/i18n/translations/${locale}.json`), 'utf8'));
    expect(RETIRED_KEYS.filter((path) => lookup(json, path) !== undefined)).toEqual([]);
  });
});
