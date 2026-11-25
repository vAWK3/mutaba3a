import { useTIn } from '../../lib/i18n';
import { legalLanguageOf } from '../../content/legal/language';
import { LegalPage } from './LegalPage';

/*
 * Authoring note: the policy is ordinary copy (landing.privacyPolicy.*), not a frozen, accepted text like the terms
 * (MUT-324), so a revision is an edit plus a new "Last updated" date. Legal wording is Basel's: a draft waits in
 * docs/operations/before-release.md until he approves it. MUT-369 was the "next real revision" MUT-402 D4 waited
 * for: English now says MTB3A, and the brand-name guard no longer exempts the policy.
 */

/*
 * The legal pages rewrite (2026-11-25, MUT-644 comment 13504): the topics an Israeli invoicing SaaS's policy covers
 * (who is responsible, law and purposes, tax documents, data abroad, security, cookies, retention, rights). A DRAFT
 * until Basel approves it: its [TODO(...)] brackets are notes for the lawyer, and the web preflight refuses a release
 * that still carries one (docs/operations/before-release.md).
 */
const SECTION_KEYS = [
  'scope',
  'whoWeAre',
  'lawAndPurposes',
  'mobile',
  'hostedAccounts',
  // MUT-369: self-service signup (Turnstile, the DNS/RDAP domain check) and the account emails (Resend)
  'createAccount',
  'email',
  'whatYouEnter',
  // The signed-out portal (ADR-097), issuing (ADR-260..273) and Malafat or another connected app (ADR-254)
  'localMode',
  'issuedDocuments',
  'connectedApps',
  'network',
  'sharing',
  // MUT-382 (epic MUT-558): accountant access (MUT-559), share links (MUT-560) and their downloads (MUT-314)
  'accountant',
  'shareLinks',
  'abroad',
  'security',
  // MUT-710 (ADR-274): two-step sign-in and the 12-month security log
  'dataSecurity',
  'noTracking',
  'usageAnalytics',
  'errorReports',
  'cookies',
  // MUT-644 (Basel, 2026-11-25): 7 years from each issued document's date; erasure only after the archive
  'retention',
  'mobileDeletion',
  'yourRights',
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
