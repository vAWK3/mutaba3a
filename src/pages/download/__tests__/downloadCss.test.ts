import { describe, it, expect } from 'vitest';
import { parseCss, repoPath } from '../../../test/css/brandCss';

/**
 * jsdom doesn't apply stylesheets, so how /download looks is proved in
 * qa/specs/web/landing.spec.ts (@web.landing.download); this keeps the title
 * from being silently restyled by a second rule.
 */

const downloadCss = parseCss(repoPath('src/pages/download/DownloadPage.css'));

describe('DownloadPage.css', () => {
  it('styles the page title in one rule (a leftover legacy rule once reset it to 20px, margin 0)', () => {
    let count = 0;
    downloadCss.walkRules((rule) => {
      if (rule.parent?.type === 'root' && rule.selectors.includes('.download-title')) count += 1;
    });
    expect(count).toBe(1);
  });
});
