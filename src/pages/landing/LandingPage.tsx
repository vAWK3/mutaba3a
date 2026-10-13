import { useEffect, useRef } from 'react';
import './LandingPage.css';
import { useT } from '../../lib/i18n';
import { useInView } from '../../hooks/useInView';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import {
  LandingHeader,
  HeroSection,
  ChapterSection,
  PrivacyBand,
  GetItSection,
  FAQSection,
  LandingFooter,
} from './components';
import { ClientProfileMock, ProfileSwitcherMock, RecordPaymentMock } from './components/mocks';

/**
 * One idea per chapter (MUT-75, brief L7): the job, then the client page,
 * recording a payment, many businesses, privacy said once, how to get it, FAQ.
 */
export function LandingPage() {
  const t = useT();
  const heroCtaRef = useRef<HTMLAnchorElement>(null);
  // Unknown (no report yet, or no IntersectionObserver) reads as "on screen": the hero's button is the way in.
  const heroCtaGone = useInView(heroCtaRef) === false;
  useDocumentTitle(t('landing.meta.title'));

  useEffect(() => {
    // iOS Safari applies :active only when a touch listener is present, so without this taps get no press state (L10).
    const noop = () => {};
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);

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
        <FAQSection />
      </main>
      <LandingFooter />
    </div>
  );
}
