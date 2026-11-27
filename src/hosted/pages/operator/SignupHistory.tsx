import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../../components/ui/Badge';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api, type SignupReview } from '../../api/client';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { reviewChips } from '../../data/signupReviews';
import { useOperatorSignups } from '../../data/operatorQueries';
import { dayText } from '../../operator/time';
import { ChipBadge } from './OperatorSignupsPage';

const SKELETON_ROWS = 4;

/** The decided reviews, newest first (read-only history once OPEN_SIGNUP is on). */
const signupHistoryQuery = {
  queryKey: ['operator', 'signup-reviews', 'decided'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => api.operatorSignupHistory(signal),
};

/**
 * MUT-737 (wireframe mut-737 A, AC3/AC4): with open sign-up there is nothing to review, so the Signups tab becomes a
 * filter of the Accounts list: every sign-up that went through the review, newest first, with the domain class (a risk
 * signal only) and its outcome. No Approve or Decline. A sign-up still waiting (one the release script hasn't reached)
 * reads Waiting.
 */
export function SignupHistory() {
  const t = useT();
  const decided = useQuery(signupHistoryQuery);
  const waiting = useOperatorSignups();
  const rows: SignupReview[] = [...(waiting.data?.data ?? []), ...(decided.data?.data ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <QueryView
      queries={[decided]}
      data={rows}
      isEmpty={(list) => list.length === 0}
      loading={<Skeleton rows={SKELETON_ROWS} />}
      empty={<Empty title={t('hosted.operator.history.empty')} />}
    >
      {(list) => (
        <ul className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.history.listLabel')} data-testid="signup-history">
          {list.map((review) => (
            <HistoryRow key={review.id} review={review} />
          ))}
        </ul>
      )}
    </QueryView>
  );
}

function HistoryRow({ review }: { review: SignupReview }) {
  const t = useT();
  const { language } = useLanguage();
  const outcome = review.decision === 'APPROVED' ? 'approved' : review.decision === 'DECLINED' ? 'declined' : 'waiting';
  const tone = outcome === 'approved' ? 'success' : outcome === 'declined' ? 'error' : 'neutral';
  return (
    <li className="hp-passkey-row" data-testid="signup-history-row">
      <span className="hp-passkey-text">
        <span className="hp-passkey-name hp-operator-email" dir="ltr">
          {review.email ?? review.domain}
        </span>
        <span className="hp-option-sub">{dayText(review.createdAt, language)}</span>
        <span className="hp-operator-chips">
          {reviewChips(review).map((chip, i) => (
            <ChipBadge key={i} chip={chip} />
          ))}
        </span>
      </span>
      <Badge variant={tone} size="sm">
        {t(`hosted.operator.history.${outcome}`)}
      </Badge>
    </li>
  );
}
