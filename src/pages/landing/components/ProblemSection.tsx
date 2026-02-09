import { useT } from '../../../lib/i18n';
import './ProblemSection.css';

const AlertIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export function ProblemSection() {
  const t = useT();

  const problems = [
    {
      title: t('landing.problem.item1Title'),
      desc: t('landing.problem.item1Desc'),
    },
    {
      title: t('landing.problem.item2Title'),
      desc: t('landing.problem.item2Desc'),
    },
    {
      title: t('landing.problem.item3Title'),
      desc: t('landing.problem.item3Desc'),
    },
    {
      title: t('landing.problem.item4Title'),
      desc: t('landing.problem.item4Desc'),
    },
  ];

  return (
    <section className="landing-section landing-problem">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.problem.headline')}</h2>
        <p className="problem-intro">{t('landing.problem.intro')}</p>

        <div className="problem-grid">
          {problems.map((problem, idx) => (
            <div key={idx} className="problem-card">
              <div className="problem-card-icon">
                <AlertIcon />
              </div>
              <h3 className="problem-card-title">{problem.title}</h3>
              <p className="problem-card-desc">{problem.desc}</p>
            </div>
          ))}
        </div>

        <div className="problem-solution">
          <p className="problem-solution-text">{t('landing.problem.solution')}</p>
        </div>
      </div>
    </section>
  );
}
