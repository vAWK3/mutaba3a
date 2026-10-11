/**
 * `next` after sign-in (mut-43-auth-states.md §3): only a same-origin relative
 * path is followed. Anything that could leave the origin (`//host`, `/\host`, a
 * scheme), a control character, or a loop back to sign-in becomes `/`.
 */
const HOME = '/';
const SIGN_IN = '/sign-in';

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return HOME;
  if (next.startsWith('//') || next.startsWith('/\\')) return HOME;
  if (/[\u0000-\u001f\u007f]/.test(next)) return HOME;
  const path = next.split(/[?#]/, 1)[0];
  if (path === SIGN_IN || path.startsWith(`${SIGN_IN}/`)) return HOME;
  return next;
}
