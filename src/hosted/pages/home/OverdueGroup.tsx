import { Link } from '@tanstack/react-router';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { OverdueClient } from '../../data/homeTodo';
import { HomeGroup } from './HomeGroup';

/**
 * Clients overdue (MUT-657): the most late clients by name and how many days late, each opening the client; no
 * amounts (home shows no totals). See all opens Owed. A Remind action waits for reminders (MUT-602).
 */
export function OverdueGroup({ profileId, count, clients, names }: { profileId: string; count: number; clients: OverdueClient[]; names: ReadonlyMap<string, { name: string }> | undefined }) {
  const { t } = useLanguage();
  const tp = useTp();
  return (
    <HomeGroup
      title={t('hosted.home.overdue.title')}
      count={count}
      countLabel={tp('hosted.home.overdue.count', count)}
      seeAll={{ to: `/p/${profileId}/owed`, label: t('hosted.home.seeAll'), name: t('hosted.home.overdue.seeAll') }}
    >
      <ul className="hp-home-people">
        {clients.map(({ customerId, daysOverdue }) => (
          <li key={customerId}>
            <Link to={`/p/${profileId}/clients/${customerId}`} dir="auto">
              {names?.get(customerId)?.name ?? '—'}
            </Link>
            <span className="hp-home-late">{daysOverdue === null ? t('hosted.home.overdue.late') : tp('hosted.home.overdue.daysLate', daysOverdue)}</span>
          </li>
        ))}
      </ul>
    </HomeGroup>
  );
}
