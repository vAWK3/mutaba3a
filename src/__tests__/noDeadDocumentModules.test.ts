import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * MUT-145 guard: document/invoice generation is retired (digital ledger
 * only). A partial revert must not bring back a module, a route target, the
 * PDF renderer or the fonts only it used. Filed receipts and the hosted
 * portal's attachments (src/hosted) are a different feature and stay.
 */
const ROOT = join(__dirname, '..');
const REPO = join(ROOT, '..');
const GONE = [
  'features/documents',
  'pages/documents',
  'pages/transactions',
  'pages/settings/ProfileDetailPage.tsx',
  'components/drawers/DocumentDrawer.tsx',
  'components/modals/PdfDownloadChoiceModal.tsx',
  'components/modals/PdfDownloadChoiceModal.css',
  'components/icons/DocumentIcon.tsx',
  'services/paymentRequestService.ts',
  'services/pdfArchival.ts',
  'demo/seedData/documents.ts',
];
const DELETED_NAMES =
  /@react-pdf|documentRepo|documentSequenceRepo|openDocumentDrawer|DocumentDrawer|useDocuments?\(|pdfArchival|paymentRequestService|['"(]\/fonts\//;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'hosted' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe('document generation after MUT-145', () => {
  it.each(GONE)('%s no longer exists', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(false);
  });

  it('the PDF-only fonts are gone from public/', () => {
    expect(existsSync(join(REPO, 'public/fonts'))).toBe(false);
  });

  it('@react-pdf/renderer is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('@react-pdf/renderer');
  });

  it('no app source references a deleted document module', () => {
    const offenders = sourceFiles(ROOT)
      .filter((path) => DELETED_NAMES.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it('the barrels no longer export document pieces', () => {
    expect(readFileSync(join(ROOT, 'components/drawers/index.ts'), 'utf8')).not.toContain('Document');
    expect(readFileSync(join(ROOT, 'components/modals/index.ts'), 'utf8')).not.toContain('PdfDownloadChoice');
    expect(readFileSync(join(ROOT, 'components/icons/index.ts'), 'utf8')).not.toContain('DocumentIcon');
  });
});
