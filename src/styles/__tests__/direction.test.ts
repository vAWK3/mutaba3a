// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * MUT-109 (TD-048, direction half; brief .claude/designs/mut-109-rtl-direction.md).
 * Direction comes from <html dir> (I18nProvider) and the dir attribute only. A
 * :lang() rule that sets `direction` matches every element and beats the dir
 * attribute, which is how every dir="ltr" came to be ignored in Arabic.
 *
 * jsdom runs no cascade, so how each site renders is proved in a browser
 * (qa/specs/web/direction.spec.ts, qa/specs/portal/direction.spec.ts); this file
 * holds the source to the classification those specs check.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(extension: string): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith(extension) && !file.includes('__tests__') && !/\.test\.[tj]sx?$/.test(file))
    .map((file) => `src/${file.split('\\').join('/')}`);
}

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

type Kind = 'ltr' | 'rtl' | 'auto';

/**
 * Every dir attribute in the app, by file. A new one fails this test until it is
 * classified here; see the brief's §3.2 for each site's reason.
 */
const DIR_SITES: Record<string, Partial<Record<Kind, number>>> = {
  // B: text that reads left to right in any language
  'src/hosted/pages/you/YouPage.tsx': { ltr: 1, auto: 1 }, // MUT-425: the account's email; the person's name (D)
  'src/hosted/shell/YouIsland.tsx': { auto: 1 }, // MUT-426: the open profile's name on the island (D)
  'src/hosted/pages/you/YouProfiles.tsx': { auto: 1 }, // MUT-425: each profile's name (D)
  'src/hosted/components/ProfilesManageDrawer.tsx': { ltr: 1, auto: 1 }, // currency code; the profile name (D)
  'src/hosted/components/ProfileEditForm.tsx': { ltr: 1, auto: 1 }, // IANA timezone; the name input (D)
  'src/hosted/components/ProfileOwnersSection.tsx': { ltr: 2, auto: 1 }, // MUT-373: an owner's email and the support address; their name (D)
  'src/hosted/components/ProfileCreateDrawer.tsx': { auto: 1 }, // the name input (D)
  'src/hosted/components/TimezoneChoice.tsx': { ltr: 2 }, // timezone select and readout (MUT-368: shared by New profile and signup)
  'src/hosted/pages/views/DocumentsList.tsx': { ltr: 1 }, // invoice number
  'src/hosted/pages/views/PaymentsList.tsx': { ltr: 1 }, // payment number
  'src/hosted/pages/auth/SignInPage.tsx': { ltr: 2 }, // email, password
  'src/hosted/pages/auth/SetupPage.tsx': { ltr: 2, auto: 1 }, // account email, password; the new account's name (D, MUT-368)
  'src/hosted/pages/auth/EmailLinkForm.tsx': { ltr: 1 }, // the email on /signup and /recover (MUT-368)
  'src/hosted/components/ChangePasswordDrawer.tsx': { ltr: 2 }, // passwords
  // MUT-434: the MCP address and the Claude Code command read left to right; agents' self-declared names are auto
  'src/hosted/components/CopyField.tsx': { ltr: 1 },
  'src/hosted/components/ConnectClaudeDrawer.tsx': { ltr: 1, auto: 2 },
  'src/hosted/pages/connect/ConsentPage.tsx': { ltr: 1, auto: 2 }, // the redirect host; the client's name
  'src/hosted/components/PasskeysDrawer.tsx': { ltr: 1, auto: 3 }, // the step-up password; passkey names in the list and the rename field (MUT-115 DR11)
  'src/hosted/components/CloseAccountDrawer.tsx': { ltr: 2 }, // the password, and the address being closed inside the sentence (MUT-333)
  'src/hosted/components/FilterControls.tsx': { ltr: 1 }, // date input
  'src/pages/landing/components/HostedRequestForm.tsx': { ltr: 2 }, // email, phone
  // A′: Expenses' "coming up" amounts, left to right before MUT-109 and kept so (brief D2)
  // C: amount inputs and their currency groups
  'src/components/expenses/ExpenseFormFields.tsx': { ltr: 1 },
  'src/hosted/components/IncomeCaptureDrawer.tsx': { ltr: 1 },
  'src/hosted/components/ConversionDrawer.tsx': { ltr: 2 },
  'src/hosted/components/RecordPaymentDrawer.tsx': { ltr: 1 },
  // D: a title that takes its direction from its own first letter
  // E: Arabic text
  // F: a legal text in the language a /terms?lang link names, when it isn't the page's (MUT-324 review fix 1)
  'src/pages/landing/LegalPage.tsx': { ltr: 1, rtl: 1 },
  // G: the portal's last-resort crash screen, above the language provider: Arabic, then English (MUT-149 design D8)
  'src/hosted/observability/LastResortBoundary.tsx': { ltr: 1, rtl: 1 },
};

/**
 * A: locale-formatted amounts. The Arabic CLDR string starts with RLM, so a plain
 * <bdi> (dir=auto) resolves it right to left: the order these amounts have always
 * had on screen. dir="ltr" here would flip them (what reverted MUT-79).
 */
const PLAIN_AMOUNT_BDI = [
  'src/hosted/format/DecimalAmount.tsx',
];

/** JSX dir attributes only, either quote: whitespace before `dir`, so a comment's `dir="ltr"` in backticks doesn't count. */
const DIR_ATTRIBUTE = /\sdir=(["'])(ltr|rtl|auto)\1/g;

function dirCounts(source: string): Partial<Record<Kind, number>> {
  const counts: Partial<Record<Kind, number>> = {};
  for (const match of source.matchAll(DIR_ATTRIBUTE)) {
    const kind = match[2] as Kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

describe('MUT-109: direction comes from <html dir> and the dir attribute', () => {
  it('no CSS rule sets direction on a :lang() selector', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('.css')) {
      postcss.parse(read(file)).walkRules((rule) => {
        if (!rule.nodes.some((node) => node.type === 'decl' && node.prop === 'direction')) return;
        for (const selector of rule.selectors) if (selector.includes(':lang(')) offenders.push(`${file}: ${selector}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every dir attribute in the app is classified in DIR_SITES, with its count', () => {
    const found: Record<string, Partial<Record<Kind, number>>> = {};
    for (const file of sourceFiles('.tsx')) {
      const counts = dirCounts(read(file));
      if (Object.keys(counts).length > 0) found[file] = counts;
    }
    expect(found).toEqual(DIR_SITES);
  });

  it('no dir attribute is computed (dir={…}), so the classification above is the whole story', () => {
    const dynamic = sourceFiles('.tsx').filter((file) => /\sdir=\{/.test(read(file)));
    expect(dynamic).toEqual([]);
  });

  it.each(PLAIN_AMOUNT_BDI)('%s wraps its amount in a plain <bdi>, with no dir', (file) => {
    const source = read(file);
    expect(source).toMatch(/<bdi[\s>]/);
    expect(dirCounts(source)).toEqual({});
  });
});
