import { useState } from 'react';
import { useT } from '../../../lib/i18n';
import './ProofGallerySection.css';

type Platform = 'desktop' | 'web';
const SCREENSHOTS = ['dashboard', 'documents', 'clients', 'expenses'] as const;

export function ProofGallerySection() {
  const [tab, setTab] = useState<Platform>('desktop');
  const t = useT();

  return (
    <section className="landing-section landing-proof-gallery">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.proof.headline')}</h2>
        <p className="landing-section-subheadline">{t('landing.proof.subheadline')}</p>

        <div className="gallery-tabs" role="tablist">
          <button
            onClick={() => setTab('desktop')}
            role="tab"
            aria-selected={tab === 'desktop'}
            className={`gallery-tab ${tab === 'desktop' ? 'gallery-tab--active' : ''}`}
          >
            {t('landing.proof.tabs.desktop')}
          </button>
          <button
            onClick={() => setTab('web')}
            role="tab"
            aria-selected={tab === 'web'}
            className={`gallery-tab ${tab === 'web' ? 'gallery-tab--active' : ''}`}
          >
            {t('landing.proof.tabs.web')}
          </button>
        </div>

        <div className="gallery-grid" role="tabpanel">
          {SCREENSHOTS.map((item) => (
            <figure key={item} className="gallery-item">
              <img
                src={`/assets/landing/proof-${tab}-${item}.png`}
                alt={t(`landing.proof.items.${item}Title`)}
                className="gallery-img"
              />
              <figcaption className="gallery-caption">
                <strong>{t(`landing.proof.items.${item}Title`)}</strong>
                <span>{t(`landing.proof.items.${item}Desc`)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
