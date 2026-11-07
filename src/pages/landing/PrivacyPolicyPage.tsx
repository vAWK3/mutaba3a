import { useTIn } from '../../lib/i18n';
import { legalLanguageOf } from '../../content/legal/language';
import { LegalPage } from './LegalPage';

/*
 * Authoring note: the policy is ordinary copy (landing.privacyPolicy.*), not a frozen, accepted text like the terms
 * (MUT-324), so a revision is an edit plus a new "Last updated" date. Legal wording is Basel's: a draft waits in
 * docs/operations/before-release.md until he approves it. MUT-369 was the "next real revision" MUT-402 D4 waited
 * for: English now says MTB3A, and the brand-name guard no longer exempts the policy.
 */

const SECTION_KEYS = [
  'scope',
  'mobile',
  'hostedAccounts',
  // MUT-369: self-service signup (Turnstile, the DNS/RDAP domain check) and the account emails (Resend)
  'createAccount',
  'email',
  'whatYouEnter',
  'network',
  'sharing',
  // MUT-382 (epic MUT-558): accountant access (MUT-559), share links (MUT-560) and their downloads (MUT-314)
  'accountant',
  'shareLinks',
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
