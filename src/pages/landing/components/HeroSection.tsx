import { useT } from '../../../lib/i18n';
import './HeroSection.css';

interface AnswerCardProps {
  question: string;
}

function AnswerCard({ question }: AnswerCardProps) {
  return (
    <div className="hero-answer-card">
      <span className="hero-answer-q">{question}</span>
    </div>
  );
}

export function HeroSection() {
  const t = useT();

  return (
    <section className="landing-section landing-hero">
      <div className="landing-container">
        <div className="hero-layout">
          <div className="hero-content">
            <img
              src="/icons/icon-512.png"
              alt=""
              className="landing-logo"
              width={80}
              height={80}
            />
            <h1 className="landing-brand">
              Mutaba3a
              <span className="landing-brand-ar">متابعة</span>
            </h1>
            <h2 className="landing-headline">{t('landing.hero.headline')}</h2>
            <p className="landing-subheadline">{t('landing.hero.subheadline')}</p>

            <div className="hero-answers-mini">
              <AnswerCard question={t('landing.answersMini.q1')} />
              <AnswerCard question={t('landing.answersMini.q2')} />
              <AnswerCard question={t('landing.answersMini.q3')} />
            </div>

            <p className="landing-trust">{t('landing.hero.trust')}</p>

            <div className="landing-hero-actions">
              <a href="/app" className="landing-btn landing-btn--primary">
                {t('landing.hero.ctaPrimary')}
              </a>
              <a href="/download" className="landing-btn landing-btn--secondary">
                {t('landing.hero.ctaSecondary')}
              </a>
            </div>
          </div>

          <div className="hero-preview">
            <img
              src="/assets/landing/hero-dashboard.svg"
              alt="Dashboard preview"
              className="hero-preview-img"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
