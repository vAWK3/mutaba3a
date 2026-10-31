import type { ReactNode } from 'react';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { OperatorAccount } from '../../api/client';
import { QueryView, Skeleton } from '../../components/QueryView';
import { RowGroup, RowNavLink } from '../../components/YouRows';
import { useOperatorAccount } from '../../data/operatorQueries';
import { useStepUpUntil } from '../../operator/OperatorStepUp';
import { agoText, clockText, dayText } from '../../operator/time';
import { useMe } from '../../session/me';
import { OperatorFeaturesSection } from './OperatorFeaturesSection';

const SKELETON_ROWS = 4;

/**
 * MUT-527 (Basel 2026-10-31): the console's own settings tab. That you're an operator and since when; your passkeys,
 * with the way to manage them (a deep link to You › Account › Passkeys: the passkey screens live there, not here);
 * whether this session is confirmed with your passkey and until when; and your own feature switches, the same rows
 * as on your account page, behind the same step-up (the E10 amendment).
 */
export function OperatorYouPage() {
  const userId = useMe().user.id;
  const query = useOperatorAccount(userId);
  return (
    <QueryView queries={[query]} data={query.data} loading={<Skeleton rows={SKELETON_ROWS} />}>
      {(view) => <YouSettings account={view.account} stepUpUntil={view.stepUpUntil} />}
    </QueryView>
  );
}

function YouSettings({ account, stepUpUntil }: { account: OperatorAccount; stepUpUntil: string | null }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const now = new Date();
  const until = useStepUpUntil(stepUpUntil);
  const confirmedUntil = until !== null && Date.parse(until) > now.getTime() ? until : null;
  const confirmed = confirmedUntil !== null;
  const passkeyUse = account.passkeyLastUsedAt ? t('hosted.operator.you.lastUsed', { time: agoText(account.passkeyLastUsedAt, now, language) }) : t('hosted.operator.you.neverUsed');
  return (
    <div className="hp-operator-account">
      <RowGroup label={t('hosted.operator.you.title')}>
        <StaticRow
          label={account.operatorSince ? t('hosted.operator.you.operatorSince', { date: dayText(account.operatorSince, language) }) : t('hosted.operator.you.operator')}
          sub={t('hosted.operator.you.operatorSub')}
        />
      </RowGroup>
      <RowGroup label={t('hosted.operator.you.passkeys')}>
        <StaticRow
          label={account.passkeyCount > 0 ? tp('hosted.operator.you.passkeyCount', account.passkeyCount) : t('hosted.operator.you.noPasskeys')}
          sub={account.passkeyCount > 0 ? passkeyUse : undefined}
        />
        <RowNavLink label={t('hosted.operator.you.managePasskeys')} sub={t('hosted.operator.you.managePasskeysSub')} to="/you/account" search={{ passkeys: true }} />
      </RowGroup>
      <RowGroup label={t('hosted.operator.you.confirmation')}>
        <div data-step-up={confirmed ? 'confirmed' : 'not-confirmed'}>
          <StaticRow
            label={confirmedUntil ? t('hosted.operator.you.confirmedUntil', { time: clockText(confirmedUntil, language) }) : t('hosted.operator.you.notConfirmed')}
            sub={confirmed ? t('hosted.operator.you.confirmedSub') : t('hosted.operator.you.notConfirmedSub')}
          />
        </div>
      </RowGroup>
      <OperatorFeaturesSection account={account} stepUpUntil={stepUpUntil} label={t('hosted.operator.you.yourFeatures')} />
    </div>
  );
}

/** A row that states something (no action), in the You rows' look. */
function StaticRow({ label, sub }: { label: ReactNode; sub?: ReactNode }) {
  return (
    <div className="hp-you-row hp-operator-static">
      <span className="hp-you-row-text">
        <span className="hp-you-row-label">{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}
