/**
 * en/ar dictionary parity, shared by the app's and the portal's tests (MUT-24;
 * the rule is hosted-portal.md §7.7). Both languages have the same shape and the
 * same `{var}` names per string, no Arabic string is empty, and every plural has
 * the forms its language needs: en one + other, ar all six CLDR forms.
 */

type Node = string | { [key: string]: Node };
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function isPlural(node: Node): node is Record<string, string> {
  return typeof node === 'object' && 'other' in node && Object.keys(node).every((k) => PLURAL_FORMS.includes(k));
}

function vars(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/**
 * Arabic names one of something without the number ("سجل واحد", not "1 سجل"), so
 * a `…Singular` string may drop `{count}` and nothing else.
 */
function isArabicSingular(path: string, en: string, arVars: string[]): boolean {
  if (!path.endsWith('Singular')) return false;
  return vars(en).filter((v) => v !== 'count').join() === arVars.join();
}

function comparePlural(a: Node, b: Node, path: string, problems: string[]) {
  if (!isPlural(a) || !isPlural(b)) return void problems.push(`${path}: plural in one language only`);
  if (!('one' in a && 'other' in a)) problems.push(`${path}: en plural needs one and other`);
  const missing = PLURAL_FORMS.filter((f) => !(f in b));
  if (missing.length) problems.push(`${path}: ar plural missing ${missing.join(', ')}`);
  const named = (forms: Record<string, string>) => [...new Set(Object.values(forms).flatMap(vars))].filter((v) => v !== 'count').sort();
  if (named(a).join() !== named(b).join()) problems.push(`${path}: plural vars differ`);
}

function compare(a: Node, b: Node, path: string, problems: string[]) {
  if (isPlural(a) || isPlural(b)) return comparePlural(a, b, path, problems);
  if (typeof a !== typeof b) return void problems.push(`${path}: ${typeof a} vs ${typeof b}`);
  if (typeof a === 'string') {
    const arVars = vars(b as string);
    if (vars(a).join() !== arVars.join() && !isArabicSingular(path, a, arVars)) {
      problems.push(`${path}: vars ${vars(a)} vs ${arVars}`);
    }
    if (!(b as string).trim()) problems.push(`${path}: empty in ar`);
    return;
  }
  const bObj = b as Record<string, Node>;
  const keys = new Set([...Object.keys(a), ...Object.keys(bObj)]);
  for (const key of keys) {
    if (!(key in a)) problems.push(`${path}.${key}: only in ar`);
    else if (!(key in bObj)) problems.push(`${path}.${key}: only in en`);
    else compare(a[key], bObj[key], `${path}.${key}`, problems);
  }
}

/** Every way `ar` differs from `en`; empty when the two are in parity. */
export function parityProblems(en: object, ar: object): string[] {
  const problems: string[] = [];
  compare(en as Node, ar as Node, '', problems);
  return problems;
}
