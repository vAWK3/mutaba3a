/// <reference types="node" />
// Node's types by name: since the local app's retirement (MUT-445) nothing else brings them into the app's typecheck
import { createHash } from 'node:crypto';

/**
 * MUT-324 (D11): the public list of released terms versions and their text
 * fingerprints, emitted by the web build as `/legal/terms-versions.json`.
 * The server release preflight reads it before releasing a server whose
 * CURRENT_TERMS names a version: Netlify answers every path with the app
 * shell, so `/terms/<version>` itself can't prove the version is live.
 *
 * Node only (the Vite config and tests): never import it from page code.
 */
export const TERMS_MANIFEST_FILE = 'legal/terms-versions.json';

const TERMS_FILE = /^(\d{4}-\d{2}-\d{2})\.(en|ar)\.json$/;
const LOCALES = ['en', 'ar'] as const;

export interface TermsManifest {
  versions: Array<{ version: string; sha256: Record<(typeof LOCALES)[number], string> }>;
}

export function termsManifest(files: ReadonlyArray<{ name: string; bytes: Uint8Array }>): TermsManifest {
  const byVersion = new Map<string, Partial<Record<(typeof LOCALES)[number], string>>>();
  // Dotfiles (.DS_Store) are the OS's, not ours; any other file must be a text, so a misnamed one fails the build
  for (const { name, bytes } of files.filter((file) => !file.name.startsWith('.'))) {
    const match = TERMS_FILE.exec(name);
    if (!match) throw new Error(`terms: ${name} is not <YYYY-MM-DD>.<en|ar>.json`);
    const [, version, locale] = match as unknown as [string, string, (typeof LOCALES)[number]];
    byVersion.set(version, { ...byVersion.get(version), [locale]: createHash('sha256').update(bytes).digest('hex') });
  }
  const versions = [...byVersion.entries()].map(([version, sha256]) => {
    for (const locale of LOCALES) if (!sha256[locale]) throw new Error(`terms: ${version} has no ${locale} text`);
    return { version, sha256: sha256 as Record<(typeof LOCALES)[number], string> };
  });
  return { versions: versions.sort((a, b) => (a.version < b.version ? 1 : -1)) };
}
