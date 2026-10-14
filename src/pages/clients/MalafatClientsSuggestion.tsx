import { useLanguage, useT } from '../../lib/i18n';
import { useActiveProfile } from '../../hooks/useActiveProfile';
import { useClients } from '../../hooks/useQueries';
import { useMalafatSuggestions, useDismissMalafatMoment } from '../../lib/useMalafatSuggestions';
import { pickClientsMoment } from '../../lib/malafatSuggestions';
import { malafatUrl } from '../../content/malafatLinks';
import { useSampleSessionStore } from '../../demo/sampleSessionStore';
import { useDemoStore } from '../../demo/demoStore';
import { MalafatSuggestionCard } from '../../components/malafat/MalafatSuggestionCard';
import { useMalafatMomentStore } from '../../lib/malafatMomentStore';
import type { MalafatMoment } from '../../types';

const TEXT_KEYS: Record<MalafatMoment, string> = {
  'business-profile': 'settings.profile.malafat.businessAdded',
  'client-threshold': 'clients.malafat.clientThreshold',
  'second-business': 'clients.malafat.secondBusiness',
};

/**
 * The Clients page's one Malafat suggestion (MUT-190): at ten clients in the
 * working business (C2), else once a second business exists (C3). Nothing
 * until every read has settled, nothing in sample or demo data, and after a
 * dismissal nothing more until the app reloads (kept in the session store, so
 * leaving the list and coming back never pops another).
 * ClientsPage places it only beside a non-empty list, with no search and no
 * client open beside it.
 */
export function MalafatClientsSuggestion({ onGone }: { onGone: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const suggestions = useMalafatSuggestions();
  const { activeProfileId, profiles } = useActiveProfile();
  const { data: clients, isSuccess } = useClients(undefined);
  const sampleOpen = useSampleSessionStore((s) => s.status !== 'none');
  const demo = useDemoStore((s) => s.isActive);
  const retire = useDismissMalafatMoment();
  const retiredThisVisit = useMalafatMomentStore((s) => s.clientsRetiredThisVisit);
  const markClientsRetired = useMalafatMomentStore((s) => s.markClientsRetired);
  const businessNoteDue = useMalafatMomentStore((s) => s.businessAdded);

  if (retiredThisVisit || !suggestions || !isSuccess || !clients || !activeProfileId || sampleOpen || demo) return null;

  const moment = pickClientsMoment({
    suggestions,
    clientCount: clients.filter((client) => client.profileId === activeProfileId).length,
    businessCount: profiles.length,
  });
  // A second business just added is the Settings note's to mention: one event, one suggestion
  if (!moment || (moment === 'second-business' && businessNoteDue)) return null;

  return (
    <MalafatSuggestionCard
      key={moment}
      label={t('clients.malafat.label')}
      text={t(TEXT_KEYS[moment])}
      href={malafatUrl({ locale: language, medium: 'web-local', content: moment, contact: true })}
      ctaLabel={t('clients.malafat.cta')}
      dismissLabel={t('clients.malafat.dismiss')}
      onRetire={() => {
        markClientsRetired();
        retire.mutate(moment);
      }}
      onGone={onGone}
    />
  );
}
