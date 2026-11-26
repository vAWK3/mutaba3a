import { useId } from 'react';
import { BlockingDialog } from '../../components/ui/BlockingDialog';
import { useT } from '../../lib/i18n/core';
import { useMe } from '../session/me';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { PickActiveBusiness } from './StarterPlan';

/**
 * MUT-731 (ADR-284, wireframe 3, Basel Q5 and Q9): someone on Starter with more businesses than it keeps active picks
 * the one that stays active before anything else. DESIGN.md's one BlockingDialog over the dimmed portal: no close,
 * nothing chosen first, every business read-only behind it until they pick. It shows after moving to Starter and
 * after a carry-over with several businesses (the same `/v1/me` answer). It steps aside while Billing's Subscribe
 * step is open ("See plans"), and comes back if they close it without buying.
 */
export function PickActiveBusinessDialog() {
  const t = useT();
  const titleId = useId();
  const me = useMe();
  const drawers = useAccountDrawers();
  const state = me.plan?.businesses;
  if (!state?.mustChoose || drawers.state.billing) return null;
  const businesses = me.profiles.filter((p) => state.readOnly.includes(p.id) || state.active.includes(p.id));
  return (
    <BlockingDialog labelledBy={titleId} className="hp-card hp-signin-card hp-terms-dialog">
      <h2 id={titleId}>{t('hosted.billing.pickActive.title')}</h2>
      <PickActiveBusiness businesses={businesses} titleId={titleId} />
    </BlockingDialog>
  );
}
