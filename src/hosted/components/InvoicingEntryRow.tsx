import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useIssuingSetup } from '../data/issuingQueries';
import { useIsLocalMode } from '../session/mode';
import { RowGroup, RowNavLink } from './YouRows';

/**
 * MUT-646: the way into the open profile's invoicing setup, in You › Profiles. Shown only where issuing is on for the
 * profile (the setup answers; a 404 means the owner's feature is off), never signed out, where nothing is issued.
 */
export function InvoicingEntryRow({ profile }: { profile: HostedProfile }) {
  const local = useIsLocalMode();
  return local || profile.type === 'PERSONAL' ? null : <Row profile={profile} />;
}

function Row({ profile }: { profile: HostedProfile }) {
  const t = useT();
  const setup = useIssuingSetup(profile.id);
  if (!setup.data) return null;
  return (
    <RowGroup>
      <RowNavLink
        to={`/p/${profile.id}/you/invoicing`}
        label={t('hosted.invoicing.entryRow')}
        sub={t(setup.data.canIssue ? 'hosted.invoicing.entryReady' : 'hosted.invoicing.entrySub')}
      />
    </RowGroup>
  );
}
