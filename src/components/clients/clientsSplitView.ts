/**
 * The Clients split view's rules (MUT-84, ADR-050), as pure functions.
 *
 * On a wide window a client opens beside the list. ↑/↓ walk the clients and
 * the profile follows. Enter, or the arrow pointing at the profile, moves
 * focus into it; Escape, or the arrow pointing back, returns to the list.
 * Arrows follow the screen: in Arabic the columns mirror and the profile sits
 * on the left, so ← goes in and → comes back.
 *
 * The walk visits clients only. The muted rows ("No client", "Archived
 * clients", MUT-83) are not clients: they open /income, which would leave
 * the page in the middle of a walk.
 */

import type { Direction } from '../../lib/i18n';
import type { ClientIndexItem } from './clientIndexRows';

/**
 * How the Clients page is arranged:
 * - `list`: no client open; the list alone, full width.
 * - `split`: a client open on a wide window; the list narrows to a column and the profile sits beside it.
 * - `profile`: a client open on a narrow window; the profile alone, full page.
 */
export type SplitLayout = 'list' | 'split' | 'profile';

export function splitLayout(hasClient: boolean, isWide: boolean): SplitLayout {
  if (!hasClient) return 'list';
  return isWide ? 'split' : 'profile';
}

const towardProfile = (direction: Direction) => (direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
const towardList = (direction: Direction) => (direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft');

export type ListKeyAction = 'previous' | 'next' | 'toProfile';

/** What a key pressed on a client row asks for, if anything. */
export function listKeyAction(key: string, direction: Direction): ListKeyAction | undefined {
  if (key === 'ArrowUp') return 'previous';
  if (key === 'ArrowDown') return 'next';
  if (key === 'Enter' || key === towardProfile(direction)) return 'toProfile';
  return undefined;
}

/** What a key pressed inside the profile asks for, if anything. */
export function profileKeyAction(key: string, direction: Direction): 'toList' | undefined {
  return key === 'Escape' || key === towardList(direction) ? 'toList' : undefined;
}

const clientIds = (items: ClientIndexItem[]) => items.flatMap((item) => (item.type === 'client' ? [item.row.id] : []));

/** The client `step` places after (1) or before (-1) `fromId` in display order; none past either end. */
export function adjacentClientId(items: ClientIndexItem[], fromId: string, step: 1 | -1): string | undefined {
  const ids = clientIds(items);
  const at = ids.indexOf(fromId);
  return at === -1 ? undefined : ids[at + step];
}

/** The first client in display order, if any. */
export function firstClientId(items: ClientIndexItem[]): string | undefined {
  return clientIds(items)[0];
}

/** Widgets that use the arrow keys or Escape themselves. */
const KEY_OWNING_ROLES = ['menu', 'listbox', 'dialog', 'tablist', 'radiogroup', 'combobox'];
const KEY_OWNING_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[aria-expanded="true"]',
  ...KEY_OWNING_ROLES.map((role) => `[role="${role}"]`),
].join(', ');

/**
 * Whether a key pressed on `target` belongs to the control it was pressed in:
 * a field being typed in, an open menu or popup, a picker. The split view
 * leaves those keys alone.
 */
export function keyBelongsToControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(KEY_OWNING_SELECTOR) !== null;
}

/** Whether a modifier is held. Alt+← is the browser's Back, so a held modifier is never the split view's. */
export function hasModifier(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

/**
 * The client profile route's `remountDeps`: the client id. Opening another
 * client gives it a fresh profile (filters reset, scrolled to the top), as
 * opening a profile always did; a resize never changes it, so a profile
 * stays mounted while the layout switches around it.
 */
export function clientProfileRemountDeps({ params }: { params: { clientId: string } }) {
  return params.clientId;
}

/** The link of the client row for `clientId` inside `container`, if it is listed. */
export function clientRowLink(container: ParentNode | null | undefined, clientId: string | undefined): HTMLElement | null {
  if (!container || !clientId) return null;
  const rows = container.querySelectorAll<HTMLElement>('tr[data-client-id]');
  const row = Array.from(rows).find((r) => r.dataset.clientId === clientId);
  return row?.querySelector<HTMLElement>('a') ?? null;
}
