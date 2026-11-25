import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { ReceiptCard } from '../../components/ReceiptCard';
import { TO_REVIEW_STRIP } from '../../data/homeTodo';
import { useReceipts } from '../../data/receiptQueries';
import { HomeGroup } from './HomeGroup';

/**
 * To review (MUT-657): a strip of the receipts waiting to be checked and filed, each card its status and day (and a
 * vendor where there is one), never an amount. See all opens the gallery, whose default list is To review.
 */
export function ToReviewGroup({ profileId, count }: { profileId: string; count: number }) {
  const { t } = useLanguage();
  const tp = useTp();
  const list = useReceipts(profileId, 'to_review', TO_REVIEW_STRIP);
  const gallery = `/p/${profileId}/expenses/receipts`;
  return (
    <HomeGroup
      title={t('hosted.home.toReview.title')}
      count={count}
      countLabel={tp('hosted.home.toReview.count', count)}
      seeAll={{ to: gallery, label: t('hosted.home.seeAll'), name: t('hosted.home.toReview.seeAll') }}
    >
      <ul className="hp-home-strip" aria-label={t('hosted.home.toReview.title')}>
        {(list.data ?? []).slice(0, TO_REVIEW_STRIP).map((item) => (
          <ReceiptCard key={item.id} profileId={profileId} item={item} to={`${gallery}/${item.id}`} showAmount={false} />
        ))}
      </ul>
    </HomeGroup>
  );
}
