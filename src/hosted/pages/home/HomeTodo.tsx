import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { HostedProfile } from '../../api/client';
import { Skeleton, Unreachable } from '../../components/QueryView';
import { OVERDUE_SHOWN, overdueClientCount, overdueClients } from '../../data/homeTodo';
import { useCustomerDirectory, useOrganizationSummary } from '../../data/queries';
import { useReceiptsAvailability, type ReceiptsAvailability } from '../../data/receiptQueries';
import { useWriteGate } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { ReceiptsUnavailable } from '../views/ReceiptsGallery';
import { OverdueGroup } from './OverdueGroup';
import { ReceiptDropZone } from './ReceiptDropZone';
import { ToReviewGroup } from './ToReviewGroup';
import { ToIssueGroup } from './ToIssueGroup';
import { useDocumentsDueCount } from '../../data/documentsDueQueries';
import { useInvoicingWorthAsking } from '../../data/issuingQueries';
import { useCurrentVatPeriod } from '../../data/vatPeriodQueries';
import { clientVatVisible } from '../client-books/vatPeriodRules';
import { VatPeriodGroup } from './VatPeriodGroup';

/**
 * Home's Receipts & to-dos (MUT-657, "Two lanes"): an Add lane beside a Waiting lane, Add first in reading order and
 * mirrored in Arabic. Nothing here is a total: receipts show status and day, clients show how late, never how much.
 */
export function HomeTodo({ profile, onAddIncome }: { profile: HostedProfile; onAddIncome: (() => void) | undefined }) {
  const { availability, toReview } = useReceiptsAvailability(profile.id);
  return (
    <div className="hp-home-lanes">
      <AddLane profile={profile} availability={availability} onAddIncome={onAddIncome} />
      <WaitingLane profile={profile} availability={availability} toReview={toReview ?? 0} />
    </div>
  );
}

function AddLane({ profile, availability, onAddIncome }: { profile: HostedProfile; availability: ReceiptsAvailability; onAddIncome: (() => void) | undefined }) {
  const { t } = useLanguage();
  const id = useId();
  const { writable } = useWriteGate();
  const local = useIsLocalMode();
  const receipts = writable && availability === 'on';
  if (!receipts && availability !== 'off' && !onAddIncome) return null;
  return (
    <section className="hp-home-add" aria-labelledby={id}>
      <h2 id={id} className="sr-only">
        {t('hosted.home.add.title')}
      </h2>
      {receipts && <ReceiptDropZone profileId={profile.id} />}
      {availability === 'off' && (
        <>
          <ReceiptsUnavailable />
          {local && (
            <Link to="/sign-in" className="hp-link-button">
              {t('hosted.local.signIn')}
            </Link>
          )}
        </>
      )}
      {onAddIncome && (
        <div className="hp-home-add-row">
          <Button variant="secondary" size="sm" onClick={onAddIncome}>
            {t('hosted.home.add.income')}
          </Button>
        </div>
      )}
    </section>
  );
}

function WaitingLane({ profile, availability, toReview }: { profile: HostedProfile; availability: ReceiptsAvailability; toReview: number }) {
  const { t } = useLanguage();
  const id = useId();
  const summary = useOrganizationSummary(profile.id);
  const names = useCustomerDirectory(profile.id);
  const local = useIsLocalMode();
  const reviewing = availability === 'on' ? toReview : 0;
  const overdue = summary.data ? overdueClientCount(summary.data) : 0;
  // MUT-660: null where invoicing is off (and on this device), so the group never shows there.
  const toIssueCount = useDocumentsDueCount(profile.id, useInvoicingWorthAsking(profile));
  const toIssue = toIssueCount.data ?? 0;
  // MUT-783: the client's VAT period; never read on this device (no accountant there), and nothing while the switch is off.
  const vat = useCurrentVatPeriod(profile.id, !local).data ?? null;
  const vatShown = vat !== null && clientVatVisible(vat, new Date());

  let body;
  if (summary.isError) body = <Unreachable onRetry={() => void summary.refetch()} />;
  else if (summary.isPending || availability === 'checking') body = <Skeleton rows={2} />;
  else if (reviewing === 0 && overdue === 0 && toIssue === 0 && !vatShown) body = <CalmLine />;
  else
    body = (
      <>
        {reviewing > 0 && <ToReviewGroup profileId={profile.id} count={reviewing} />}
        {overdue > 0 && summary.data && <OverdueGroup profileId={profile.id} count={overdue} clients={overdueClients(summary.data, OVERDUE_SHOWN)} names={names.data} />}
        {toIssue > 0 && <ToIssueGroup profileId={profile.id} count={toIssue} names={names.data} />}
        {vatShown && vat && <VatPeriodGroup profileId={profile.id} period={vat} />}
        {/* MUT-604's rhythm and period cards will sit under these groups */}
      </>
    );

  return (
    <section className="hp-home-waiting" aria-labelledby={id}>
      <h2 id={id} className="sr-only">
        {t('hosted.home.waiting.title')}
      </h2>
      {body}
    </section>
  );
}

function CalmLine() {
  const { t } = useLanguage();
  return (
    <div className="hp-home-calm">
      <p className="hp-home-calm-title">{t('hosted.home.clear.title')}</p>
    </div>
  );
}
