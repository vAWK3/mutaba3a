import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../../lib/i18n/core';
import type { Expense, ExpenseGroup } from '../../api/client';
import { verbFor, type Verb } from '../../data/expenseGroups';
import { invalidateGroups, sendMark, useExpenseGroups } from '../../data/expenseGroupQueries';
import { usePopover } from '../../shell/usePopover';
import { useToast } from '../Toast';

/**
 * "In groups" on an expense (MUT-268 11A): the groups it is in, each a link
 * with its own verb from the action table (Leave out inside the dates, Remove
 * when kept from outside them), and "Add to group…" for the profile's other
 * groups (a keep mark). Omitted while either list loads or fails (8A): the
 * line is a convenience, never a reason for the drawer to look broken.
 */
export function InGroupsLine({ profileId, expense }: { profileId: string; expense: Expense }) {
  const { t } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const inGroups = useExpenseGroups(profileId, expense.id);
  const allGroups = useExpenseGroups(profileId);
  const { open, close, toggle, buttonRef, panelRef } = usePopover();
  const [busy, setBusy] = useState(false);

  if (!inGroups.data || !allGroups.data) return null;
  const memberOf = new Set(inGroups.data.map((g) => g.id));
  const others = allGroups.data.filter((g) => !memberOf.has(g.id));

  async function change(group: ExpenseGroup, verb: Verb) {
    close(false);
    setBusy(true);
    try {
      await sendMark(profileId, group.id, expense.id, verb);
      showToast(t(verb === 'add' ? 'hosted.groups.inGroups.added' : 'hosted.groups.inGroups.removed', { name: group.name }), { tone: 'info' });
    } catch {
      showToast(t('hosted.groups.inGroups.failed'));
    } finally {
      setBusy(false);
      void invalidateGroups(queryClient, profileId);
    }
  }

  return (
    <div className="hp-in-groups">
      <span className="form-label">{t('hosted.groups.inGroups.label')}</span>
      <ul className="hp-in-groups-list">
        {inGroups.data.length === 0 && <li className="hp-muted">{t('hosted.groups.inGroups.none')}</li>}
        {inGroups.data.map((group) => {
          const verb = verbFor('member', expense.occurredOn, group);
          const action = t(`hosted.groups.inGroups.${verb === 'leaveOut' ? 'leaveOut' : 'remove'}`);
          return (
            <li key={group.id}>
              <Link to={`/p/${profileId}/expenses/groups/${group.id}`} className="hp-link">
                {group.name}
              </Link>{' '}
              <button type="button" className="hp-link-button hp-muted press" disabled={busy} aria-label={t('hosted.groups.inGroups.actionLabel', { action, name: group.name })} onClick={() => void change(group, verb)}>
                {action}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="hp-in-groups-add">
        <button ref={buttonRef} type="button" className="hp-link-button press" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle}>
          {t('hosted.groups.inGroups.add')}
        </button>
        {open && (
          <div ref={panelRef} className="hp-popover hp-grow-from-start hp-in-groups-menu" role="menu" aria-label={t('hosted.groups.inGroups.menu')}>
            {others.length === 0 ? (
              <p className="hp-menu-note hp-muted">{t('hosted.groups.inGroups.noOther')}</p>
            ) : (
              others.map((group) => (
                <button key={group.id} type="button" role="menuitem" className="hp-menu-item press" onClick={() => void change(group, 'add')}>
                  {group.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
