import './LandingPage.css';
import './HostedOfferPage.css';
import '../../components/ui/Button.css';
import { useT } from '../../lib/i18n';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { MOBILE_APP_LINKS } from '../../content/download-config';
import { LandingHeader, LandingFooter } from './components';
import { HostedRequestForm } from './components/HostedRequestForm';
import { HostedDevicesMock } from './components/mocks';

const T = 'landing.hostedOffer';

/** The comparison's rows (1A). `free: false` means the free app has nothing to put there. */
const COMPARE_ROWS = [
  { key: 'where', free: true },
  { key: 'devices', free: true },
  { key: 'phone', free: false },
  { key: 'lost', free: true },
  { key: 'malafat', free: false },
  { key: 'account', free: true },
  { key: 'price', free: true },
] as const;

const PLATFORMS = ['ios', 'android'] as const;

/** Which phone apps exist today. Availability only: this page never links a store (9A). */
function PhoneAvailability() {
  const t = useT();
  return (
    <span className="hosted-platforms">
      {PLATFORMS.map((platform) => {
        const name = t(`${T}.platform.${platform}`);
        return MOBILE_APP_LINKS[platform].available ? (
          <span key={platform} className="hosted-platform">
            {name}
          </span>
        ) : (
          <span key={platform} className="hosted-platform hosted-platform--soon">
            {t(`${T}.platform.comingSoon`, { platform: name })}
          </span>
        );
      })}
    </span>
  );
}

function Comparison() {
  const t = useT();
  const freeCol = t(`${T}.compare.colFree`);
  const hostedCol = t(`${T}.compare.colHosted`);

  return (
    <table className="hosted-compare-table">
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">{t(`${T}.compare.colTopic`)}</span>
          </th>
          <th scope="col">{freeCol}</th>
          <th scope="col" className="hosted-compare-hosted">
            {hostedCol}
          </th>
        </tr>
      </thead>
      <tbody>
        {COMPARE_ROWS.map(({ key, free }) => (
          <tr key={key}>
            <th scope="row">{t(`${T}.compare.rows.${key}.label`)}</th>
            <td data-col={freeCol} className={free ? undefined : 'hosted-compare-none'}>
              {free ? (
                t(`${T}.compare.rows.${key}.free`)
              ) : (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{t(`${T}.compare.none`)}</span>
                </>
              )}
            </td>
            <td data-col={hostedCol} className="hosted-compare-hosted">
              {t(`${T}.compare.rows.${key}.hosted`)}
              {key === 'phone' && <PhoneAvailability />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * /hosted (MUT-186): makes the case for a hosted account to people using the
 * free app, then takes a request Basel answers with an offer by hand. One idea
 * per section: the trade, the comparison, the migration promise, the form.
 * Mounted outside the router like /privacy, so it uses landing chrome only.
 */
export function HostedOfferPage() {
  const t = useT();
  useDocumentTitle(t('common.pageTitle', { page: t(`${T}.meta.title`) }));

  return (
    <div className="landing-page">
      <a href="#main-content" className="landing-skip-link">
        {t('landing.skipToContent')}
      </a>
      <LandingHeader homeHref="/" />
      <main id="main-content">
        <section data-part="hero" className="landing-section hosted-hero" aria-labelledby="hosted-title">
          <div className="landing-container hosted-hero-layout">
            <div className="hosted-hero-copy">
              <h1 id="hosted-title" className="hosted-hero-title">
                {t(`${T}.hero.title`)}
              </h1>
              <p className="hosted-hero-sub">{t(`${T}.hero.sub`)}</p>
              <a href="#request" className="btn btn-primary btn-lg hosted-hero-cta">
                {t(`${T}.hero.cta`)}
              </a>
              <p className="hosted-hero-noprice">{t(`${T}.hero.noPrice`)}</p>
            </div>
            <HostedDevicesMock />
          </div>
        </section>

        <section data-part="compare" className="landing-section hosted-compare" aria-labelledby="hosted-compare-title">
          <div className="landing-container">
            <h2 id="hosted-compare-title" className="landing-section-headline landing-section-headline--start">
              {t(`${T}.compare.title`)}
            </h2>
            <p className="hosted-lead">{t(`${T}.compare.lead`)}</p>
            <Comparison />
          </div>
        </section>

        <section data-part="band" className="landing-section landing-privacy-band" aria-labelledby="hosted-band-title">
          <div className="landing-container">
            <h2 id="hosted-band-title" className="landing-privacy-title">
              {t(`${T}.band.title`)}
            </h2>
            <p className="landing-privacy-body">{t(`${T}.band.body`)}</p>
          </div>
        </section>

        <section id="request" data-part="request" className="landing-section hosted-request" aria-labelledby="hosted-request-title">
          <div className="landing-container hosted-request-container">
            <h2 id="hosted-request-title" className="landing-section-headline landing-section-headline--start">
              {t(`${T}.form.title`)}
            </h2>
            <p className="hosted-lead">{t(`${T}.form.lead`)}</p>
            <HostedRequestForm titleId="hosted-request-title" />
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
