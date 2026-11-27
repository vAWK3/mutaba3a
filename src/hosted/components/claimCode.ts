/**
 * MUT-770: CodeReveal's rules, pure so each is a unit test. A claim code is six digits, shown 3 and 3, heard one by one.
 */

/** The claim-code spec's hold before Copied reverts to Copy. */
export const COPIED_HOLD_MS = 2000;
const GROUP = 3;

/** The digits alone ("481 702" → "481702"). */
export function bareCode(code: string): string {
  return code.replace(/\s+/g, '');
}

/** "481702" → ["481", "702"]; three digits or fewer stay one group. */
export function codeGroups(code: string): string[] {
  const digits = bareCode(code);
  if (digits.length <= GROUP) return [digits];
  const groups: string[] = [];
  for (let at = 0; at < digits.length; at += GROUP) groups.push(digits.slice(at, at + GROUP));
  return groups;
}

/** What a screen reader says: each digit apart, so "481702" is never read as a number. */
export function spokenCode(code: string): string {
  return bareCode(code).split('').join(' ');
}
