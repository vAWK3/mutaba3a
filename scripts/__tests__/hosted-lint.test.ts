// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

/**
 * The portal's lint guards (MUT-43 test plan §2) fire on in-memory code placed
 * at a portal path. If someone loosens `eslint.config.js`, this fails.
 */

const eslint = new ESLint({ cwd: process.cwd() });

async function rulesFor(code: string, filePath = 'src/hosted/pages/__probe__.tsx'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? 'fatal');
}

describe('portal lint guards', () => {
  it.each([
    ["import { db } from '../../db';"],
    ["import { syncNow } from '../../sync/engine';"],
    ["import { useClients } from '../../hooks/useClients';"],
    ["import { AppShell } from '../../components/layout/AppShell';"],
    ["import { IncomeDrawer } from '../../components/drawers/IncomeDrawer';"],
    ["import { useToastStore } from '../../lib/toastStore';"],
    ["import { useT } from '../../lib/i18n';"],
    ["import { LanguageProvider } from '../../lib/i18n/context';"],
    ["import Dexie from 'dexie';"],
  ])('forbids %s', async (line) => {
    expect(await rulesFor(`${line}\nexport const x = 1;\n`)).toContain('no-restricted-imports');
  }, 30_000);

  it('allows the shared after-save store and hook in lib/ (MUT-91), not their old hooks/ home', async () => {
    const shared = "import { useSavedFlashRows } from '../../lib/useSavedFlash';\nimport { useSavedFlashStore } from '../../lib/savedFlashStore';\nexport const x = [useSavedFlashRows, useSavedFlashStore];\n";
    expect(await rulesFor(shared)).not.toContain('no-restricted-imports');
    expect(await rulesFor("import { useSavedFlashRows } from '../../hooks/useSavedFlash';\nexport const x = useSavedFlashRows;\n")).toContain('no-restricted-imports');
  }, 30_000);

  it('allows the i18n core and the shared UI kit', async () => {
    const code = "import { useT } from '../../lib/i18n/core';\nimport { Button } from '../../components/ui/Button';\nexport const x = [useT, Button];\n";
    expect(await rulesFor(code)).not.toContain('no-restricted-imports');
  }, 30_000);

  it.each([['Number(amount)'], ['parseFloat(amount)'], ['parseInt(amount, 10)'], ['Number.parseFloat(amount)'], ['+amount']])(
    'forbids %s on anything in the portal',
    async (expression) => {
      expect(await rulesFor(`const amount = '1.10';\nexport const n = ${expression};\n`)).toContain('no-restricted-syntax');
    },
    30_000,
  );

  // ADR-097 (MUT-286): server code runs in the page only from src/hosted/local, and only the allowlisted modules.
  describe('local mode', () => {
    const LOCAL = 'src/hosted/local/__probe__.ts';

    it('forbids the portal from importing server code', async () => {
      expect(await rulesFor("import { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';\nexport const x = MemoryLedgerStore;\n")).toContain('no-restricted-imports');
    }, 30_000);

    it('forbids a static import of the local backend: it must stay a lazy chunk', async () => {
      expect(await rulesFor("import { bootLocalBackend } from '@mut/local-backend';\nexport const x = bootLocalBackend;\n")).toContain('no-restricted-imports');
    }, 30_000);

    it('lets the local backend import the allowlisted server modules', async () => {
      const code = "import { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';\nimport { PORTAL_ROUTES } from '../../../server/src/routes/portal-routes.js';\nexport const x = [MemoryLedgerStore, PORTAL_ROUTES];\n";
      expect(await rulesFor(code, LOCAL)).not.toContain('no-restricted-imports');
    }, 30_000);

    it.each([
      ["import { sessionRoutes } from '../../../server/src/routes/sessions.js';"],
      ["import { createApp } from '../../../server/src/app.js';"],
      ["import { PrismaLedgerStore } from '../../../server/src/repositories/prisma.js';"],
    ])('forbids the local backend %s', async (line) => {
      expect(await rulesFor(`${line}\nexport const x = 1;\n`, LOCAL)).toContain('no-restricted-imports');
    }, 30_000);

    it('keeps the portal bans in the local backend too', async () => {
      expect(await rulesFor("import Dexie from 'dexie';\nexport const x = Dexie;\n", LOCAL)).toContain('no-restricted-imports');
      expect(await rulesFor("const amount = '1.10';\nexport const n = Number(amount);\n", LOCAL)).toContain('no-restricted-syntax');
    }, 30_000);
  });

  // MUT-149 (ADR-091 am.11): the browser Sentry setup reuses MUT-148's contract and scrubber, and nothing else of the server.
  describe('crash reporting', () => {
    const SHARED = 'src/lib/observability/__probe__.ts';
    const RULE = '@typescript-eslint/no-restricted-imports';

    it('lets the shared browser setup import the contract and the scrubber, and the SDK types', async () => {
      const code =
        "import type { BrowserOptions } from '@sentry/browser';\nimport { SENTRY_RULES } from '../../../server/src/observability/sentry-rules';\nimport { scrubEvent } from '../../../server/src/observability/sentry-scrub';\nexport const x: [BrowserOptions, unknown, unknown] = [{}, SENTRY_RULES, scrubEvent];\n";
      expect(await rulesFor(code, SHARED)).not.toContain(RULE);
    }, 30_000);

    it.each([
      ["import { createSentryReporter } from '../../../server/src/observability/sentry-node';"],
      ["import { createApp } from '../../../server/src/app';"],
      ["import * as Sentry from '@sentry/browser';"],
    ])('forbids the shared browser setup %s', async (line) => {
      expect(await rulesFor(`${line}\nexport const x = 1;\n`, SHARED)).toContain(RULE);
    }, 30_000);

    it.each([['src/hosted/pages/__probe__.tsx'], ['src/hosted/observability/errorReporting.ts'], ['src/hosted/analytics/__probe__.ts'], ['src/pages/landing/__probe__.tsx'], ['src/components/__probe__.tsx']])(
      'loads the SDK only from the portal lazy chunk, not %s',
      async (path) => {
        expect(await rulesFor("import * as Sentry from '@sentry/browser';\nexport const x = Sentry;\n", path)).toContain(RULE);
      },
      30_000,
    );

    it('lets the landing lazy chunk load the SDK (MUT-150)', async () => {
      expect(await rulesFor("import * as Sentry from '@sentry/browser';\nexport const x = Sentry;\n", 'src/pages/landing/observability/landingSentry.ts')).not.toContain(RULE);
    }, 30_000);

    it.each([['src/components/__probe__.tsx'], ['src/pages/__probe__.tsx'], ['src/lib/__probe__.ts']])(
      'keeps the landing error reports out of the local app: %s may not import them (MUT-150 review, ADR-024)',
      async (path) => {
        const code = "import { reportLandingCrash } from '../pages/landing/observability/landingErrorReporting';\nexport const x = reportLandingCrash;\n";
        expect(await rulesFor(code, path)).toContain('no-restricted-imports');
      },
      30_000,
    );

    it('lets main.tsx start the website error reports', async () => {
      const code = "// eslint-disable-next-line no-restricted-imports -- the one place the website's error reports start (MUT-150)\nimport { startLandingErrorReporting } from './pages/landing/observability/landingErrorReporting';\nexport const x = startLandingErrorReporting;\n";
      expect(await rulesFor(code, 'src/main.tsx')).not.toContain('no-restricted-imports');
    }, 30_000);

    it('lets the portal lazy chunk load the SDK', async () => {
      expect(await rulesFor("import * as Sentry from '@sentry/browser';\nexport const x = Sentry;\n", 'src/hosted/observability/portalSentry.ts')).not.toContain(RULE);
    }, 30_000);
  });

  it('leaves the local app alone', async () => {
    expect(await rulesFor("export const n = Number('1');\n", 'src/lib/__probe__.ts')).not.toContain('no-restricted-syntax');
  }, 30_000);
});
