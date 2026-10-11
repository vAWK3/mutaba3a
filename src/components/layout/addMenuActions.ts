/**
 * What the two `+ Add` menus offer, and in which order (MUT-15).
 *
 * The sidebar's **New** menu and the top bar's **Add** menu both render this
 * list; each maps an action to its own label, icon and click behaviour.
 * Core actions come first and optional ones after, so switching an area on or
 * off never moves a core entry (the same rule as the sidebar's core group).
 */

import type { FeatureKey } from '../../types';
import type { FeatureFlags } from '../../lib/features/features';

export type AddMenuAction = 'income' | 'client' | 'expense' | 'project';

const ADD_MENU_ACTIONS: readonly { action: AddMenuAction; feature?: FeatureKey }[] = [
  { action: 'income' },
  { action: 'client' },
  { action: 'expense', feature: 'expenses' },
  { action: 'project', feature: 'projects' },
];

/** The actions to show for these flags, in menu order. */
export function visibleAddMenuActions(flags: FeatureFlags): AddMenuAction[] {
  return ADD_MENU_ACTIONS.filter((item) => !item.feature || flags[item.feature]).map((item) => item.action);
}
