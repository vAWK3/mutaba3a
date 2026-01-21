import { useState } from 'react';
import { useT } from '../../../lib/i18n';
import './UseCasesSection.css';

const USE_CASES = ['receivables', 'retainers', 'expenses', 'documents', 'forecast'] as const;
type UseCase = (typeof USE_CASES)[number];

export function UseCasesSection() {
  const [active, setActive] = useState<UseCase>('receivables');
  const t = useT();

  return (
    <section className="landing-section landing-use-cases">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.useCases.headline')}</h2>
        <p className="landing-section-subheadline">{t('landing.useCases.subheadline')}</p>

        <div className="use-cases-tabs" role="tablist">
          {USE_CASES.map((key) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              role="tab"
              aria-selected={active === key}
              className={`use-case-tab ${active === key ? 'use-case-tab--active' : ''}`}
            >
              {t(`landing.useCases.tabs.${key}`)}
            </button>
          ))}
        </div>

        <div className="use-case-content" role="tabpanel">
          <div className="use-case-journey">
            <p className="use-case-outcome">{t(`landing.useCases.${active}.outcome`)}</p>
            <ol className="use-case-steps">
              <li>{t(`landing.useCases.${active}.step1`)}</li>
              <li>{t(`landing.useCases.${active}.step2`)}</li>
              <li>{t(`landing.useCases.${active}.step3`)}</li>
            </ol>
          </div>
          <div className="use-case-preview">
            <img
              src={`/assets/landing/usecase-${active}.svg`}
              alt={t(`landing.useCases.tabs.${active}`)}
              className="use-case-img"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
