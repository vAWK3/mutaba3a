import { useT } from '../../lib/i18n';
import { LegalPage } from './LegalPage';

const SECTION_KEYS = [
  'scope',
  'dataStorage',
  'mobile',
  'hostedAccounts',
  'whatYouEnter',
  'network',
  'sharing',
  'security',
  'noTracking',
  'usageAnalytics',
  'yourControl',
  'mobileDeletion',
  'children',
  'changes',
  'hostedRequest',
  'contact',
] as const;

/**
 * The policy for every Mutaba3a app: the local-only Mac, Windows, and browser apps, and the
 * account-based portal and iPhone and Android apps that store data on the hosted API (Google Cloud).
 */
export function PrivacyPolicyPage() {
  const t = useT();
  return (
    <LegalPage
      title={t('landing.privacyPolicy.title')}
      updated={t('landing.privacyPolicy.updated')}
      intro={t('landing.privacyPolicy.intro')}
      sections={SECTION_KEYS.map((key) => ({ title: t(`landing.privacyPolicy.${key}.title`), paragraphs: [t(`landing.privacyPolicy.${key}.body`)] }))}
    />
  );
}
