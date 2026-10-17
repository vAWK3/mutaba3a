// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

/**
 * ADR-090 / MUT-154: posthog-js may be imported only by the landing's and the
 * portal's analytics modules. The local app (and so the desktop build) must
 * never carry the SDK (ADR-024). If someone loosens `eslint.config.js`, this fails.
 */

const eslint = new ESLint({ cwd: process.cwd() });

async function rulesFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? 'fatal');
}

const VALUE_IMPORT = "import posthog from 'posthog-js';\nexport const x = posthog;\n";
const TYPE_IMPORT = "import type { PostHogConfig } from 'posthog-js';\nexport type X = PostHogConfig;\n";
const restricted = (rules: string[]) => rules.some((rule) => rule.endsWith('no-restricted-imports'));

describe('posthog-js stays in the analytics modules', () => {
  it.each([
    'src/main.tsx',
    'src/pages/landing/LandingProviders.tsx',
    'src/pages/landing/LandingPage.tsx',
    'src/pages/clients/__probe__.tsx',
    'src/components/layout/__probe__.tsx',
    'src/lib/__probe__.ts',
    'src/hosted/HostedApp.tsx',
    'src/hosted/shell/__probe__.tsx',
  ])('forbids importing the SDK from %s', async (filePath) => {
    expect(restricted(await rulesFor(VALUE_IMPORT, filePath))).toBe(true);
  }, 30_000);

  it.each(['src/pages/landing/analytics/landingAnalytics.ts', 'src/hosted/analytics/portalAnalytics.ts'])(
    'allows the SDK in %s',
    async (filePath) => {
      expect(restricted(await rulesFor(VALUE_IMPORT, filePath))).toBe(false);
    },
    30_000,
  );

  it('allows the shared library to import the SDK\'s types', async () => {
    expect(restricted(await rulesFor(TYPE_IMPORT, 'src/lib/analytics/posthogConfig.ts'))).toBe(false);
  }, 30_000);

  it('forbids the shared library from loading the SDK itself (review F7)', async () => {
    expect(restricted(await rulesFor(VALUE_IMPORT, 'src/lib/analytics/posthogConfig.ts'))).toBe(true);
  }, 30_000);

  it('keeps the storage seam in the shared library while adding the PostHog rule', async () => {
    const dbImport = "import { db } from '../../db';\nexport const x = db;\n";
    expect(restricted(await rulesFor(dbImport, 'src/lib/analytics/__probe__.ts'))).toBe(true);
  }, 30_000);
});

describe('the counting code stays with the pages that count (review F2, F4)', () => {
  const LANDING_COUNTER = "import { useLandingAnalytics } from '../landing/analytics/landingAnalytics';\nexport const x = useLandingAnalytics;\n";
  const GUARD = "import { posthogInitOptions } from '../../lib/analytics/posthogConfig';\nexport const x = posthogInitOptions;\n";

  it.each(['src/pages/clients/__probe__.tsx', 'src/pages/settings/__probe__.tsx'])('forbids a local-app page in %s from starting the landing counter', async (filePath) => {
    expect(restricted(await rulesFor(LANDING_COUNTER, filePath))).toBe(true);
  }, 30_000);

  it.each(['src/pages/clients/__probe__.tsx', 'src/pages/landing/__probe__.tsx', 'src/pages/download/__probe__.tsx'])(
    'forbids %s from loading the guard with the page, outside the analytics module',
    async (filePath) => {
      expect(restricted(await rulesFor(GUARD, filePath))).toBe(true);
    },
    30_000,
  );

  it.each(['src/pages/landing/__probe__.tsx', 'src/pages/download/__probe__.tsx'])('lets the landing pages in %s call the counter', async (filePath) => {
    const fromPage = filePath.includes('download') ? LANDING_COUNTER : LANDING_COUNTER.replace('../landing/analytics', './analytics');
    expect(restricted(await rulesFor(fromPage, filePath))).toBe(false);
  }, 30_000);
});
