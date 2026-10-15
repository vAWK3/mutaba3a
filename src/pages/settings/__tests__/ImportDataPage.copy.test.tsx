import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ts from 'typescript';
import { LanguageProvider } from '../../../lib/i18n';
import { chooseLanguage } from '../../../test/language';
import { repoPath } from '../../../test/css/brandCss';
import { ImportDataPage } from '../ImportDataPage';

/**
 * MUT-206 (eng review R4): Settings › Import speaks the reader's language.
 * Every user-visible string comes from `settings.import.*`; the guard keeps
 * new English from creeping back into the page's JSX.
 */

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

const PAGE = repoPath('src/pages/settings/ImportDataPage.tsx');
/** A file-extension token (".json", ".csv") is not copy: it reads the same in both languages. */
const EXTENSION = /\.[a-z]{2,4}\b/gi;

/** Every JSX text node that still holds Latin letters once file extensions are removed, with its line. */
function latinJsxText(code: string): string[] {
  const source = ts.createSourceFile('page.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text.replace(EXTENSION, ''))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${line + 1}: ${node.text.trim()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

afterEach(() => localStorage.clear());

describe('ImportDataPage copy (MUT-206 R4)', () => {
  it('opens in Arabic with an Arabic heading and drop zone', async () => {
    chooseLanguage('ar');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <ImportDataPage />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'استيراد البيانات' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /أفلت ملف/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /العودة إلى الإعدادات/ })).toBeInTheDocument();
    expect(screen.queryByText(/Import Data|Need help\?|Back to Settings/)).toBeNull();
  });

  it('has no English JSX text left in the page', () => {
    expect(latinJsxText(readFileSync(PAGE, 'utf8'))).toEqual([]);
  });

  it('the guard catches English and lets file extensions and expressions through', () => {
    const code = [
      'export const Page = () => (',
      '  <div>',
      '    <h1>Import Data</h1>',
      '    <p>{t("settings.import.select.drop")} .json · .csv</p>',
      '  </div>',
      ');',
    ].join('\n');
    expect(latinJsxText(code)).toEqual(['3: Import Data']);
  });
});
