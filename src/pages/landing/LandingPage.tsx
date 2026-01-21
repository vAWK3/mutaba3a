import './LandingPage.css';
import {
  LandingHeader,
  HeroSection,
  ProblemSection,
  UseCasesSection,
  MoneyAnswersSection,
  ProofGallerySection,
  CapabilitiesSection,
  PrivacySection,
  DownloadSection,
  PricingSection,
  FAQSection,
  FinalCTASection,
  LandingFooter,
} from './components';

export function LandingPage() {
  return (
    <div className="landing-page">
      <LandingHeader />
      <HeroSection />
      <ProblemSection />
      <UseCasesSection />
      <MoneyAnswersSection />
      <ProofGallerySection />
      <CapabilitiesSection />
      <PrivacySection />
      <DownloadSection />
      <PricingSection />
      <FAQSection />
      <FinalCTASection />
      <LandingFooter />
    </div>
  );
}
