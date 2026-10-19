import { useT } from '../../../lib/i18n';

export function LandingFooter() {
  const t = useT();

  return (
    <footer className="landing-footer">
      <div className="landing-container">
        <div className="landing-footer-content">
          <span className="landing-footer-brand">{t('landing.footer.copyright')}</span>
          <div className="landing-footer-links">
            <a href="/privacy">{t('landing.footer.privacy')}</a>
            <a href="/terms">{t('landing.footer.terms')}</a>
            <a
              href="https://buymeacoffee.com/elmokhtbr"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('landing.footer.buyMeACoffee')}
            </a>
            <a
              href="https://ko-fi.com/elmokhtbr"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('landing.footer.kofi')}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
