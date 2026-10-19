import { useT } from '../../lib/i18n';
import { LegalPage } from './LegalPage';

const SECTION_KEYS = [
  'scope',
  'mobile',
  'hostedAccounts',
  'whatYouEnter',
  'network',
  'sharing',
  'security',
  'noTracking',
  'usageAnalytics',
  'mobileDeletion',
  'children',
  'changes',
  'hostedRequest',
  'contact',
] as const;

/**
 * The policy for every Mutaba3a app: hosted-only, account-based — the web portal and the
 * iPhone and Android apps, all storing data on the hosted API (Google Cloud).
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
