import { useDrawerStore } from '../lib/stores';
import { useProfileStore } from '../lib/profileStore';
import { useFeatureFlags } from '../lib/features/useFeatures';
import { useProfileAwareAction } from './useProfileAwareAction';
import { visibleAddMenuActions, type AddMenuAction } from '../components/layout/addMenuActions';

/**
 * useAddMenuActions Hook
 *
 * The one set of create handlers behind both `+ Add` menus (sidebar's New,
 * top bar's Add). Both menus open the drawer in place -- nobody navigates --
 * and all four actions are profile-aware (MUT-57, TD-032).
 *
 * Usage:
 * ```tsx
 * const { actions, run, pickers } = useAddMenuActions();
 *
 * return (
 *   <>
 *     {actions.map((action) => (
 *       <button key={action} onClick={(e) => run(action, e, menu.buttonProps.ref.current)} />
 *     ))}
 *     <ProfileQuickPicker {...pickers.income.pickerProps} />
 *     <ProfileQuickPicker {...pickers.expense.pickerProps} />
 *     <ProfileQuickPicker {...pickers.client.pickerProps} />
 *     <ProfileQuickPicker {...pickers.project.pickerProps} />
 *   </>
 * );
 * ```
 */
export function useAddMenuActions() {
  const features = useFeatureFlags();
  const actions = visibleAddMenuActions(features);

  const openIncomeDrawer = useDrawerStore((s) => s.openIncomeDrawer);
  const openExpenseDrawer = useDrawerStore((s) => s.openExpenseDrawer);
  const openClientDrawer = useDrawerStore((s) => s.openClientDrawer);
  const openProjectDrawer = useDrawerStore((s) => s.openProjectDrawer);

  // The drawer opens in the business the picker chose: make it the working
  // business too, same as before MUT-57 (MUT-89, ADR-051). Client and
  // Project never set it -- neither menu did before this change.
  const setWorkingProfile = useProfileStore((s) => s.setWorkingProfile);

  const income = useProfileAwareAction({
    onExecute: (profileId) => {
      setWorkingProfile(profileId);
      openIncomeDrawer({ mode: 'create', defaultStatus: 'earned', defaultProfileId: profileId });
    },
  });

  const expense = useProfileAwareAction({
    onExecute: (profileId) => {
      setWorkingProfile(profileId);
      openExpenseDrawer({ mode: 'create', defaultProfileId: profileId });
    },
  });

  const client = useProfileAwareAction({
    onExecute: (profileId) => {
      openClientDrawer({ mode: 'create', defaultProfileId: profileId });
    },
  });

  const project = useProfileAwareAction({
    onExecute: (profileId) => {
      openProjectDrawer({ mode: 'create', defaultProfileId: profileId });
    },
  });

  const pickers = { income, expense, client, project };

  const run = (
    action: AddMenuAction,
    event: React.MouseEvent<HTMLElement>,
    returnFocus: HTMLElement | null,
  ) => {
    pickers[action].trigger(event, returnFocus);
  };

  return { actions, run, pickers };
}
