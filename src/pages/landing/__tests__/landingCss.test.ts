import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import type { AtRule, Root, Rule } from 'postcss';
import { parseCss, repoPath } from '../../../test/css/brandCss';

/**
 * The landing page's CSS contracts (MUT-77). jsdom doesn't apply stylesheets,
 * so what the browser does with them is proved in qa/specs/web/landing.spec.ts;
 * these keep the rules themselves from drifting.
 */

const LANDING_DIR = repoPath('src/pages/landing');
const THEME_CSS = repoPath('src/styles/theme.css');

const landingCssFiles = [
  ...readdirSync(LANDING_DIR).filter((f) => f.endsWith('.css')).map((f) => `${LANDING_DIR}/${f}`),
  ...readdirSync(`${LANDING_DIR}/components`).filter((f) => f.endsWith('.css')).map((f) => `${LANDING_DIR}/components/${f}`),
];
const landingRoots = landingCssFiles.map((file) => ({ file, root: parseCss(file) }));
const landingPageCss = parseCss(`${LANDING_DIR}/LandingPage.css`);

/** Every rule whose selector list contains `selector`, with the at-rules it sits in. */
function rulesFor(root: Root, selector: string): { rule: Rule; atRules: string[] }[] {
  const found: { rule: Rule; atRules: string[] }[] = [];
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const atRules: string[] = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule') atRules.push(`@${(parent as AtRule).name} ${(parent as AtRule).params}`);
    }
    found.push({ rule, atRules });
  });
  return found;
}

function declarations(rule: Rule): Record<string, string> {
  const result: Record<string, string> = {};
  rule.walkDecls((decl) => {
    result[decl.prop] = decl.value;
  });
  return result;
}

/** The declarations for `selector` outside any at-rule, merged in source order. */
function baseDeclarations(root: Root, selector: string): Record<string, string> {
  return Object.assign({}, ...rulesFor(root, selector).filter((r) => r.atRules.length === 0).map((r) => declarations(r.rule)));
}

describe('landing CSS', () => {
  it('has no transition: all, here or in the shared theme', () => {
    const offenders: string[] = [];
    for (const { file, root } of [...landingRoots, { file: THEME_CSS, root: parseCss(THEME_CSS) }]) {
      root.walkDecls(/^transition(-property)?$/, (decl) => {
        if (/(^|[\s,])all(\s|,|$)/.test(decl.value)) offenders.push(`${file}: ${decl.prop}: ${decl.value}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('never keys colours off [data-theme]: the page follows prefers-color-scheme through the tokens', () => {
    const offenders: string[] = [];
    for (const { file, root } of landingRoots) {
      root.walkRules((rule) => {
        if (rule.selector.includes('[data-theme')) offenders.push(`${file}: ${rule.selector}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    ['.hero-cta-primary:active', 'HeroSection.css'],
    ['.landing-header-cta[data-visible="true"]:active', 'LandingPage.css'],
    ['.landing-lang-toggle:active', 'LandingPage.css'],
    ['a.landing-get-it-option:active', 'LandingPage.css'],
    ['a.landing-phone-store:active', 'LandingPage.css'],
  ])('presses %s in with the brand press tokens', (selector, fileName) => {
    const root = landingRoots.find(({ file }) => file.endsWith(`/${fileName}`))!.root;
    // The `scale` property, never transform (ADR-074, MUT-91): it composes with any transform the control has.
    expect(baseDeclarations(root, selector)).toMatchObject({ scale: 'var(--press-scale)' });
    expect(baseDeclarations(root, selector)).not.toHaveProperty('transform');
  });

  it('writes no literal press scale or duration: the tokens zero them under reduced motion', () => {
    const offenders: string[] = [];
    for (const { file, root } of landingRoots) {
      root.walkDecls('transform', (decl) => {
        if (/scale\(\s*0?\.\d/.test(decl.value)) offenders.push(`${file}: ${decl.value}`);
      });
      root.walkDecls('scale', (decl) => {
        if (/^\s*0?\.\d/.test(decl.value)) offenders.push(`${file}: scale ${decl.value}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    '.hero-cta-alt:active',
    '.landing-footer-links a:active',
    '.landing-get-it-meta a:active',
    '.landing-phone-hint a:active',
    '.landing-faq-question:active',
  ])(
    'dims %s on press instead of scaling it (text links, and the full-width FAQ rows)',
    (selector) => {
      const all = landingRoots.flatMap(({ root }) => rulesFor(root, selector).map((r) => declarations(r.rule)));
      expect(Object.assign({}, ...all)).toMatchObject({ opacity: 'var(--landing-press-dim)' });
      expect(Object.assign({}, ...all)).not.toHaveProperty('transform');
      expect(Object.assign({}, ...all)).not.toHaveProperty('scale');
    },
  );

  it('keeps a store link\'s label colour and no underline on hover, like every landing control (TD-122)', () => {
    expect(baseDeclarations(landingPageCss, 'a.landing-phone-store:hover')).toMatchObject({
      color: 'var(--text)',
      'text-decoration': 'none',
    });
  });

  it('dims hover and press from the page\'s two dim values, never a literal opacity', () => {
    const offenders: string[] = [];
    for (const { file, root } of landingRoots) {
      root.walkRules(/:(hover|active)/, (rule) => {
        rule.walkDecls('opacity', (decl) => {
          if (!decl.value.startsWith('var(--landing-')) offenders.push(`${file}: ${rule.selector} opacity: ${decl.value}`);
        });
      });
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the bar\'s padding on phones: its rule out-ranks the phone rule for .landing-container', () => {
    expect(baseDeclarations(landingPageCss, '.landing-header .landing-header-bar')).toMatchObject({ 'padding-block': 'var(--space-3)' });
  });

  it('only dims the bar\'s button on hover while it is shown, so hovering never blocks its fade-out', () => {
    expect(rulesFor(landingPageCss, '.landing-header-cta:hover')).toEqual([]);
    expect(baseDeclarations(landingPageCss, '.landing-header-cta[data-visible="true"]:hover')).toHaveProperty('opacity');
  });

  describe('the frosted bar', () => {
    it('is sticky and frosted, with the Safari prefix', () => {
      expect(baseDeclarations(landingPageCss, '.landing-header')).toMatchObject({
        position: 'sticky',
        background: 'color-mix(in oklab, var(--bg) 85%, transparent)',
        'backdrop-filter': expect.stringContaining('blur('),
        '-webkit-backdrop-filter': expect.stringContaining('blur('),
      });
    });

    it.each([
      ['@media (prefers-reduced-transparency: reduce)'],
      ['@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'],
    ])('turns solid under %s', (atRule) => {
      const solid = rulesFor(landingPageCss, '.landing-header').find((r) => r.atRules.includes(atRule));
      expect(solid && declarations(solid.rule)).toMatchObject({
        background: 'var(--bg)',
        'backdrop-filter': 'none',
        '-webkit-backdrop-filter': 'none',
      });
    });

    it('hides its button with visibility, so it also leaves the tab order', () => {
      expect(baseDeclarations(landingPageCss, '.landing-header-cta[data-visible="false"]')).toMatchObject({
        visibility: 'hidden',
        opacity: '0',
      });
    });
  });

  it('never tightens Arabic headline tracking', () => {
    const root = landingRoots.find(({ file }) => file.endsWith('/HeroSection.css'))!.root;
    expect(baseDeclarations(root, ':lang(ar) .landing-headline-large')).toMatchObject({ 'letter-spacing': '0' });
  });

  it('rises chapter visuals by the brand stagger token, which reduced motion zeroes', () => {
    expect(baseDeclarations(landingPageCss, '.landing-chapter-visual[data-reveal="pending"]')).toMatchObject({
      opacity: '0',
      translate: '0 var(--stagger-rise)',
    });
    const theme = parseCss(THEME_CSS);
    const reduced = rulesFor(theme, ':root').filter((r) => r.atRules.includes('@media (prefers-reduced-motion: reduce)'));
    expect(Object.assign({}, ...reduced.map((r) => declarations(r.rule)))).toHaveProperty('--stagger-rise', '0px');
  });
});
