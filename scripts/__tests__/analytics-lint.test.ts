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
});
