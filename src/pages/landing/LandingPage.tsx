import './LandingPage.css';
import {
  LandingHeader,
  HeroSection,
  TrustBadgesSection,
  ValuePropsSection,
  ProblemSection,
  CapabilitiesSection,
  ProofGallerySection,
  DownloadSection,
  PricingSection,
  FAQSection,
  FinalCTASection,
  LandingFooter,
} from './components';

export function LandingPage() {
  return (
    <div className="landing-page">
      <a href="#main-content" className="landing-skip-link">
        Skip to main content
      </a>
      <LandingHeader />
      <main id="main-content">
        <HeroSection />
        <TrustBadgesSection />
        <ValuePropsSection />
        <ProblemSection />
        <CapabilitiesSection />
        <ProofGallerySection />
        <DownloadSection />
        <PricingSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  );
}
