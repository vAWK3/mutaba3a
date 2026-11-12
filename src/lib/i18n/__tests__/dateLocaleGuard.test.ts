// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// MUT-587 (R5): the lint guard refuses a hand-written Arabic date locale and a stacked -u-nu- tag, in the portal and the
// website alike, and lets getLocale(language) through.
const eslint = new ESLint();

async function dateRuleHits(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('MUT-587')).length;
}

const HEADER = "import { getLocale } from '../lib/i18n/core';\nconst language = 'ar' as 'ar' | 'en';\nconst d = new Date();\n";

describe('the Arabic date locale guard (MUT-587)', () => {
  for (const filePath of ['src/hosted/guard-probe.ts', 'src/pages/guard-probe.ts']) {
    it(`refuses hand-written Arabic locales in ${filePath}`, async () => {
      const bad = [
        "export const a = new Intl.DateTimeFormat('ar', { month: 'long' }).format(d);",
        "export const b = d.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US');",
        "export const c = new Intl.RelativeTimeFormat(`${getLocale(language)}-u-nu-latn`).format(-1, 'day');",
      ];
      expect(await dateRuleHits(HEADER + bad.join('\n'), filePath)).toBe(3);
    }, 30_000);

    it(`lets getLocale(language) through in ${filePath}`, async () => {
      const good = "export const a = new Intl.DateTimeFormat(getLocale(language), { month: 'long' }).format(d);\nexport const b = d.toLocaleDateString('en-CA');";
      expect(await dateRuleHits(HEADER + good, filePath)).toBe(0);
    }, 30_000);
  }
});
