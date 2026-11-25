import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { useDocumentsDue } from '../../data/documentsDueQueries';
import { HomeGroup } from './HomeGroup';

/** How many clients the group names; See all opens the whole list. */
export const TO_ISSUE_CLIENTS_SHOWN = 3;

/**
 * To issue (MUT-660): the documents due on an invoicing profile, as a count and the clients with the most of them, no
 * amounts (home shows no totals). See all opens Documents › To issue. The caller hides it at 0 and where invoicing is
 * off.
 */
export function ToIssueGroup({ profileId, count, names }: { profileId: string; count: number; names: ReadonlyMap<string, { name: string }> | undefined }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const list = useDocumentsDue(profileId, 'to-issue', 0);
  const nameOf = (id: string | null) => (id ? (names?.get(id)?.name ?? '—') : t('hosted.documentsDue.noClient'));
  // Most first; on a tie, No client last, then by name.
  const groups = [...(list.data?.groups ?? [])]
    .sort((a, b) => b.items.length - a.items.length || (a.customerId === null ? 1 : b.customerId === null ? -1 : nameOf(a.customerId).localeCompare(nameOf(b.customerId), language)))
    .slice(0, TO_ISSUE_CLIENTS_SHOWN);
  return (
    <HomeGroup
      title={t('hosted.documentsDue.title')}
      count={count}
      countLabel={tp('hosted.documentsDue.count', count)}
      seeAll={{ to: `/p/${profileId}/documents/to-issue`, label: t('hosted.home.seeAll'), name: t('hosted.documentsDue.seeAll') }}
    >
      <ul className="hp-home-people">
        {groups.map((g) => (
          <li key={g.customerId ?? 'none'}>
            <span dir="auto">{nameOf(g.customerId)}</span>
            <span className="hp-home-late-neutral">{tp('hosted.documentsDue.count', g.items.length)}</span>
          </li>
        ))}
      </ul>
    </HomeGroup>
  );
}
