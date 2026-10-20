// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Rule } from 'postcss';
import { parseCss, repoPath } from '../../test/css/brandCss';

/**
 * The drawer fits a phone (MUT-357): it is --drawer-width wide (480px) only
 * where the screen has room, and never wider than the viewport, so on a 375px
 * phone it fills the screen instead of hanging off its anchored edge, in
 * either direction. jsdom runs no cascade; the browser half of this is
 * qa/specs/portal/direction.spec.ts (@portal.direction.drawer-phone-*).
 */

/** `.drawer` itself, plain or under a direction or theme (not `.drawer-header` and kin). */
const DRAWER_PANEL = /(^|\s)\.drawer$/;

function drawerRules(): Rule[] {
  const rules: Rule[] = [];
  parseCss(repoPath('src/index.css')).walkRules((rule) => {
    if (rule.selectors.some((selector) => DRAWER_PANEL.test(selector))) rules.push(rule);
  });
  return rules;
}

function declsOf(rules: Rule[], prop: string): string[] {
  const values: string[] = [];
  for (const rule of rules) rule.walkDecls(prop, (decl) => void values.push(decl.value));
  return values;
}

describe('drawer fit', () => {
  const rules = drawerRules();

  it('caps the panel at the viewport', () => {
    expect(declsOf(rules, 'max-width')).toEqual(['100%']);
  });

  it('sets its width in one place, so no direction or theme undoes the cap', () => {
    expect(declsOf(rules, 'width')).toEqual(['var(--drawer-width)']);
    expect(declsOf(rules, 'min-width')).toEqual([]);
  });
});
