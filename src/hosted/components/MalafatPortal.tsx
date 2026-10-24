import { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { malafatUrl, type MalafatContent } from '../../content/malafatLinks';
import { pickClientsMoment } from '../../lib/malafatSuggestions';
import { MalafatSuggestionCard } from '../../components/malafat/MalafatSuggestionCard';
import type { Customer, HostedProfile } from '../api/client';
import { useMe, useProfile } from '../session/me';
import { useMalafatPortalMoments } from '../session/malafatMoments';
import {
  businessProfileCount,
  portalMalafatEligible,
  retireChange,
  useChangeMalafatSuggestions,
  usePortalMalafat,
} from '../data/malafatSuggestions';
import type { MalafatMoment } from '../../types';
import { RowLink, RowSwitch } from './YouRows';

const TEXT: Record<MalafatMoment, string> = {
  'business-profile': 'hosted.malafat.businessCreated',
  'client-threshold': 'hosted.malafat.clientThreshold',
  'second-business': 'hosted.malafat.secondBusiness',
};

function useMalafatLink() {
  const { language } = useLanguage();
  return (content: MalafatContent) => malafatUrl({ locale: language, medium: 'portal', content, contact: true });
}

/**
 * S1, on You › App (MUT-191, MUT-425): a link to Malafat and the "Show Malafat
 * suggestions" switch, for an eligible profile only and never for someone
 * already on Malafat.
 */
export function MalafatRows({ profile }: { profile: HostedProfile | null }) {
  const { t } = useLanguage();
  const viewerId = useMe().user.id;
  const state = usePortalMalafat();
  const change = useChangeMalafatSuggestions();
  const link = useMalafatLink();

  if (!state.allowed || !portalMalafatEligible(profile, viewerId)) return null;

  return (
    <>
      <RowLink label={t('hosted.malafat.menuLink')} href={link('settings')} />
      <RowSwitch
        label={t('hosted.malafat.menuSwitch')}
        on={state.on}
        onToggle={() => {
          if (!change.isPending) change.mutate({ off: state.on });
        }}
      />
      {/* No toast: the page says it in place, and the switch keeps the state the server has */}
      {change.isError && (
        <p role="status" className="hp-you-row-note">
          {t('hosted.malafat.saveFailed')}
        </p>
      )}
    </>
  );
}

interface ClientsCardProps {
  customers: Map<string, Customer>;
  query: string | undefined;
  /** Where focus goes once the card has gone (the search box). */
  onGone: () => void;
}

/** C2/C3 on Clients: at ten active clients, else with a second business profile; never while searching. */
export function MalafatClientsCard({ customers, query, onGone }: ClientsCardProps) {
  const { t } = useLanguage();
  const me = useMe();
  const profile = useProfile();
  const state = usePortalMalafat();
  const change = useChangeMalafatSuggestions();
  const link = useMalafatLink();
  const retiredThisVisit = useMalafatPortalMoments((s) => s.clientsRetiredThisVisit);
  const businessCreatedThisVisit = useMalafatPortalMoments((s) => s.businessCreatedThisVisit);
  const markClientsRetired = useMalafatPortalMoments((s) => s.markClientsRetired);

  if (!state.allowed || !portalMalafatEligible(profile, me.user.id) || query?.trim() || retiredThisVisit) return null;

  const activeClients = [...customers.values()].filter((customer) => customer.status === 'ACTIVE').length;
  const moment = pickClientsMoment({ suggestions: state, clientCount: activeClients, businessCount: businessProfileCount(me) });
  // A business profile created on this visit was the created note's to mention: one event, one suggestion
  if (!moment || (moment === 'second-business' && businessCreatedThisVisit)) return null;

  return (
    <MalafatSuggestionCard
      key={moment}
      label={t('hosted.malafat.label')}
      text={t(TEXT[moment])}
      href={link(moment)}
      ctaLabel={t('hosted.malafat.cta')}
      dismissLabel={t('hosted.malafat.dismiss')}
      onRetire={() => {
        markClientsRetired();
        change.mutate(retireChange(moment));
      }}
      onGone={onGone}
    />
  );
}

/** C1 on the business profile just created: once, until the person leaves the page. */
export function MalafatCreatedNote({ onGone = () => {} }: { onGone?: () => void }) {
  const profile = useProfile();
  // A fresh note per profile, so arriving at the new profile reads the mark anew
  return <CreatedNote key={profile.id} profile={profile} onGone={onGone} />;
}

function CreatedNote({ profile, onGone }: { profile: HostedProfile; onGone: () => void }) {
  const { t } = useLanguage();
  const viewerId = useMe().user.id;
  const state = usePortalMalafat();
  const change = useChangeMalafatSuggestions();
  const link = useMalafatLink();
  const clearBusinessCreated = useMalafatPortalMoments((s) => s.clearBusinessCreated);
  // Read the mark once, on arrival, and consume it: the note stays for this visit only (StrictMode-safe)
  const [arrived] = useState(() => useMalafatPortalMoments.getState().businessCreatedId === profile.id);
  useEffect(() => {
    if (arrived) clearBusinessCreated();
  }, [arrived, clearBusinessCreated]);

  const shown = arrived && state.allowed && state.on && portalMalafatEligible(profile, viewerId) && !state.dismissed.includes('business-profile');
  if (!shown) return null;
  return (
    <MalafatSuggestionCard
      label={t('hosted.malafat.label')}
      text={t(TEXT['business-profile'])}
      href={link('business-profile')}
      ctaLabel={t('hosted.malafat.cta')}
      dismissLabel={t('hosted.malafat.dismiss')}
      onRetire={() => change.mutate(retireChange('business-profile'))}
      onGone={onGone}
    />
  );
}
