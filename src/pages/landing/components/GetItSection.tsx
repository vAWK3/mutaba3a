import { useT } from '../../../lib/i18n';
import { MOBILE_APP_LINKS, storeLinkUrl } from '../../../content/download-config';
import { hostedPortalUrl } from '../../../lib/goHosted';
import { AndroidIcon, IosIcon } from './PlatformIcons';
import { HostedRequestForm } from './HostedRequestForm';

/**
 * Hosted-only "get it" (landing rewrite, retiring the free local app and the
 * /hosted comparison page): request an account, sign in if you already have
 * one, or get the phone app if your organization already set you up. The
 * request form itself lives here now, inline, instead of on its own page —
 * there's only one plan to ask for. While self-service signup is open
 * (MUT-369), "Create an account" comes first and the form stays for those who
 * want us to set it up (D6).
 */
export function GetItSection({ signupUrl = null }: { signupUrl?: string | null }) {
  const t = useT();
  const portalUrl = hostedPortalUrl();
  const iosUrl = storeLinkUrl(MOBILE_APP_LINKS.ios, 'mutaba3a-landing');
  const androidUrl = storeLinkUrl(MOBILE_APP_LINKS.android, 'mutaba3a-landing');

  return (
    <section id="get-it" data-part="get-it" aria-labelledby="get-it-title" className="landing-section landing-get-it">
      <div className="landing-container">
        <h2 id="get-it-title" className="landing-section-headline">
          {t('landing.getIt.title')}
        </h2>
        <p className="landing-get-it-lead">{t('landing.getIt.lead')}</p>

        <div className="landing-get-it-options">
          {signupUrl && (
            <a href={signupUrl} target="_blank" rel="noopener noreferrer" className="landing-get-it-option">
              <span className="landing-get-it-label">{t('landing.getIt.createCta')}</span>
              <span className="sr-only"> {t('common.opensInNewTab')}</span>
            </a>
          )}
          {portalUrl && (
            <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="landing-get-it-option">
              <span className="landing-get-it-label">{t('landing.getIt.signInCta')}</span>
            </a>
          )}
          {(iosUrl || androidUrl) && (
            <div className="landing-get-it-apps">
              <span className="landing-get-it-apps-label">{t('landing.getIt.appsLabel')}</span>
              {iosUrl && (
                <a href={iosUrl} target="_blank" rel="noopener noreferrer" className="landing-get-it-option">
                  <IosIcon size={24} />
                  <span className="landing-get-it-label">{t('landing.getIt.appsIos')}</span>
                </a>
              )}
              {androidUrl && (
                <a href={androidUrl} target="_blank" rel="noopener noreferrer" className="landing-get-it-option">
                  <AndroidIcon size={24} />
                  <span className="landing-get-it-label">{t('landing.getIt.appsAndroid')}</span>
                </a>
              )}
            </div>
          )}
        </div>

        <p className="landing-get-it-note">{t(signupUrl ? 'landing.getIt.noteOpen' : 'landing.getIt.note')}</p>

        <div className="landing-get-it-request" data-part="get-it-request">
          <h3 id="get-it-request-title" className="landing-section-headline landing-section-headline--start">
            {t(signupUrl ? 'landing.getIt.requestCtaOpen' : 'landing.getIt.requestCta')}
          </h3>
          <p className="landing-get-it-request-hint">{t('landing.getIt.requestHint')}</p>
          <HostedRequestForm titleId="get-it-request-title" />
        </div>
      </div>
    </section>
  );
}
