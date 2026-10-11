/**
 * `next` after sign-in (mut-43-auth-states.md §3): only a same-origin relative
 * path is followed. Anything that could leave the origin (`//host`, `/\host`, a
 * scheme), a control character, or a loop back to sign-in becomes `/`.
 */
const HOME = '/';
const SIGN_IN = '/sign-in';
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < FIRST_PRINTABLE || code === DELETE;
}

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return HOME;
  if (next.startsWith('//') || next.startsWith('/\\')) return HOME;
  if ([...next].some(isControl)) return HOME;
  const path = next.split(/[?#]/, 1)[0];
  if (path === SIGN_IN || path.startsWith(`${SIGN_IN}/`)) return HOME;
  return next;
}
