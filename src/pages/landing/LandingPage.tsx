import { useRef } from 'react';
import './LandingPage.css';
import { useT } from '../../lib/i18n';
import { useInView } from '../../hooks/useInView';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useLandingAnalytics } from './analytics/landingAnalytics';
import {
  LandingHeader,
  HeroSection,
  ChapterSection,
  PrivacyBand,
  GetItSection,
  PhoneSection,
  MalafatSection,
  FAQSection,
  LandingFooter,
} from './components';
import { ClientProfileMock, ProfileSwitcherMock, RecordPaymentMock } from './components/mocks';

/** At least the bar's height (≈60px wide, ≈68px on phones with 44px tap targets). */
const HERO_CTA_ROOT_MARGIN = '-72px 0px 0px 0px';

/**
 * One idea per chapter (MUT-75, brief L7): the job, then the client page,
 * recording a payment, many businesses, privacy said once, how to get it,
 * the phone and the portal (MUT-173), Malafat (MUT-174), FAQ.
 */
export function LandingPage() {
  const t = useT();
  const heroCtaRef = useRef<HTMLAnchorElement>(null);
  // The sticky bar covers the top of the viewport, so the hero's button counts as gone once it slides under the bar,
  // not once it leaves the screen; otherwise neither button is usable for a bar's height of scroll.
  // Unknown (no report yet, or no IntersectionObserver) reads as "on screen": the hero's button is the way in.
  const heroCtaGone = useInView(heroCtaRef, { rootMargin: HERO_CTA_ROOT_MARGIN }) === false;
  useDocumentTitle(t('landing.meta.title'));
  useLandingAnalytics();

  return (
    <div className="landing-page">
      <a href="#main-content" className="landing-skip-link">
        {t('landing.skipToContent')}
      </a>
      <LandingHeader showCta={heroCtaGone} />
      <main id="main-content">
        <HeroSection ctaRef={heroCtaRef} />
        <ChapterSection
          part="chapter-clients"
          title={t('landing.chapters.clients.title')}
          body={t('landing.chapters.clients.body')}
          visual={<ClientProfileMock />}
        />
        <ChapterSection
          part="chapter-payment"
          title={t('landing.chapters.payment.title')}
          body={t('landing.chapters.payment.body', {
            action: t('transactions.partialPayment.recordPayment'),
          })}
          visual={<RecordPaymentMock />}
          flip
        />
        <ChapterSection
          part="chapter-businesses"
          title={t('landing.chapters.businesses.title')}
          body={t('landing.chapters.businesses.body')}
          visual={<ProfileSwitcherMock />}
        />
        <PrivacyBand />
        <GetItSection />
        <PhoneSection />
        <MalafatSection />
        <FAQSection />
      </main>
      <LandingFooter />
    </div>
  );
}
