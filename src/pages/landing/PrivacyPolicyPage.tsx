import { useTIn } from '../../lib/i18n';
import { legalLanguageOf } from '../../content/legal/language';
import { LegalPage } from './LegalPage';

/*
 * Authoring note (MUT-402 D4): the current policy text (landing.privacyPolicy.*) still says
 * "Mutaba3a" and is exempt from the brand-name guard (src/lib/i18n/__tests__/brandName.test.ts)
 * until its next real revision, which names the product MTB3A in English and متابعة in Arabic.
 */

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
  'errorReports',
  'mobileDeletion',
  'children',
  'changes',
  'hostedRequest',
  'contact',
] as const;

/**
 * The policy for every Mutaba3a app: hosted-only, account-based — the web portal and the
 * iPhone and Android apps, all storing data on the hosted API (Google Cloud).
 * A link from the phone or the portal names its language (`?lang`, MUT-356), which wins
 * over the page language for the policy text only and is never stored, as on /terms.
 */
export function PrivacyPolicyPage({ search = '' }: { search?: string }) {
  const linked = legalLanguageOf(search);
  const t = useTIn(linked);
  return (
    <LegalPage
      textLanguage={linked ?? undefined}
      title={t('landing.privacyPolicy.title')}
      updated={t('landing.privacyPolicy.updated')}
      intro={t('landing.privacyPolicy.intro')}
      sections={SECTION_KEYS.map((key) => ({ title: t(`landing.privacyPolicy.${key}.title`), paragraphs: [t(`landing.privacyPolicy.${key}.body`)] }))}
    />
  );
}
