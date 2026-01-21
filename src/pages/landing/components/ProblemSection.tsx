import { useT } from '../../../lib/i18n';

export function ProblemSection() {
  const t = useT();

  return (
    <section className="landing-section landing-problem">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.problem.headline')}</h2>
        <ul className="landing-pain-points">
          <li>{t('landing.problem.pain1')}</li>
          <li>{t('landing.problem.pain2')}</li>
          <li>{t('landing.problem.pain3')}</li>
          <li>{t('landing.problem.pain4')}</li>
        </ul>
      </div>
    </section>
  );
}
