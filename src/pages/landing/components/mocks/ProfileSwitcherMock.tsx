import type { CSSProperties } from 'react';
import { useT } from '../../../../lib/i18n';
import { SAMPLE_BUSINESSES, SAMPLE_CLIENT } from '../../sampleData';
import { useMockFormat } from './useMockFormat';

const SAMPLE_USD_OWED_MINOR = 90000;

/** The business switcher, with the current business's totals kept per currency. */
export function ProfileSwitcherMock() {
  const t = useT();
  const { money, language } = useMockFormat();

  return (
    <div className="landing-mock landing-mock--switcher">
      <ul className="landing-mock-businesses">
        {SAMPLE_BUSINESSES.map((business, index) => (
          <li
            key={business.id}
            className={`landing-mock-business${index === 0 ? ' landing-mock-business--current' : ''}`}
            aria-current={index === 0 ? 'true' : undefined}
          >
            <span
              className="landing-mock-avatar"
              style={{ '--avatar-hue': business.hue } as CSSProperties}
              aria-hidden="true"
            >
              {language === 'ar' ? business.initialAr : business.initial}
            </span>
            <span className="landing-mock-business-name">{t(business.nameKey)}</span>
          </li>
        ))}
      </ul>

      <div className="landing-mock-owed landing-mock-owed--split">
        <span className="landing-mock-label">{t('clients.profile.owedNow')}</span>
        <span className="landing-mock-totals">
          <span className="landing-mock-amount">{money(SAMPLE_USD_OWED_MINOR, 'USD')}</span>
          <span className="landing-mock-amount">
            {money(SAMPLE_CLIENT.owedMinor, SAMPLE_CLIENT.currency)}
          </span>
        </span>
      </div>
    </div>
  );
}
