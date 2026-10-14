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
 * S1, inside the account menu (MUT-191): a link to Malafat and the "Show Malafat
 * suggestions" switch, for an eligible profile only and never for someone
 * already on Malafat. Menu items, so the menu's keyboard model holds: a link,
 * and a checkbox item that toggles without closing the menu.
 */
export function MalafatMenuItems({ profile }: { profile: HostedProfile | null }) {
  const { t } = useLanguage();
  const state = usePortalMalafat();
  const change = useChangeMalafatSuggestions();
  const link = useMalafatLink();

  if (!state.allowed || !portalMalafatEligible(profile)) return null;

  return (
    <>
      <div className="hp-menu-sep" role="separator" />
      <a role="menuitem" className="hp-menu-item press" href={link('settings')} target="_blank" rel="noopener noreferrer">
        {t('hosted.malafat.menuLink')} <span className="sr-only">{t('common.opensInNewTab')}</span>
      </a>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={state.on}
        className="hp-menu-item press"
        onClick={() => {
          if (!change.isPending) change.mutate({ off: state.on });
        }}
      >
        {t('hosted.malafat.menuSwitch')}
      </button>
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
  const businessCreatedId = useMalafatPortalMoments((s) => s.businessCreatedId);
  const markClientsRetired = useMalafatPortalMoments((s) => s.markClientsRetired);

  if (!state.allowed || !portalMalafatEligible(profile) || query?.trim() || retiredThisVisit) return null;

  const activeClients = [...customers.values()].filter((customer) => customer.status === 'ACTIVE').length;
  const moment = pickClientsMoment({ suggestions: state, clientCount: activeClients, businessCount: businessProfileCount(me) });
  // A business profile just created is the created note's to mention: one event, one suggestion
  if (!moment || (moment === 'second-business' && businessCreatedId)) return null;

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
  const state = usePortalMalafat();
  const change = useChangeMalafatSuggestions();
  const link = useMalafatLink();
  const clearBusinessCreated = useMalafatPortalMoments((s) => s.clearBusinessCreated);
  // Read the mark once, on arrival, and consume it: the note stays for this visit only (StrictMode-safe)
  const [arrived] = useState(() => useMalafatPortalMoments.getState().businessCreatedId === profile.id);
  useEffect(() => {
    if (arrived) clearBusinessCreated();
  }, [arrived, clearBusinessCreated]);

  const shown = arrived && state.allowed && state.on && portalMalafatEligible(profile) && !state.dismissed.includes('business-profile');
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
