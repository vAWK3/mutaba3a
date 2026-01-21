import { useT } from '../../../lib/i18n';
import './MoneyAnswersSection.css';

interface AnswerCardProps {
  title: string;
  description: string;
}

function AnswerCard({ title, description }: AnswerCardProps) {
  return (
    <div className="money-answer-card">
      <h3 className="money-answer-title">{title}</h3>
      <p className="money-answer-desc">{description}</p>
    </div>
  );
}

export function MoneyAnswersSection() {
  const t = useT();

  return (
    <section className="landing-section landing-money-answers">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.moneyAnswers.headline')}</h2>
        <p className="landing-section-subheadline">{t('landing.moneyAnswers.subheadline')}</p>

        <div className="money-answer-cards">
          <AnswerCard
            title={t('landing.moneyAnswers.card1Title')}
            description={t('landing.moneyAnswers.card1Desc')}
          />
          <AnswerCard
            title={t('landing.moneyAnswers.card2Title')}
            description={t('landing.moneyAnswers.card2Desc')}
          />
          <AnswerCard
            title={t('landing.moneyAnswers.card3Title')}
            description={t('landing.moneyAnswers.card3Desc')}
          />
        </div>

        <div className="money-answers-forecast">
          <h3 className="forecast-title">{t('landing.moneyAnswers.forecastTitle')}</h3>
          <p className="forecast-desc">{t('landing.moneyAnswers.forecastDesc')}</p>
        </div>

        <div className="money-answers-preview">
          <img
            src="/assets/landing/screenshot-answers.svg"
            alt="Money Answers Dashboard"
            className="money-answers-img"
          />
        </div>
      </div>
    </section>
  );
}
