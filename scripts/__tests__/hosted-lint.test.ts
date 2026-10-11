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

  it('leaves the local app alone', async () => {
    expect(await rulesFor("export const n = Number('1');\n", 'src/lib/__probe__.ts')).not.toContain('no-restricted-syntax');
  }, 30_000);
});
