import type { ReactNode } from 'react';
import { useT } from '../../../lib/i18n';
import { MOBILE_APP_LINKS, storeLinkUrl } from '../../../content/download-config';
import { hostedPortalUrl } from '../../../lib/goHosted';
import { AndroidIcon, BrowserIcon, ChevronIcon, IosIcon } from './PlatformIcons';
import { HostedRequestForm } from './HostedRequestForm';

/** One way in: icon, label, and a chevron saying it goes somewhere (a new tab). */
function OptionTile({ href, icon, label, primary = false }: { href: string; icon?: ReactNode; label: string; primary?: boolean }) {
  const t = useT();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`landing-get-it-option${primary ? ' landing-get-it-option--primary' : ''}`}
    >
      {icon}
      <span className="landing-get-it-label">{label}</span>
      <span className="sr-only"> {t('common.opensInNewTab')}</span>
      <span className="landing-get-it-chevron">
        <ChevronIcon />
      </span>
    </a>
  );
}

/**
 * Hosted-only "get it" (landing rewrite, retiring the free local app and the
 * /hosted comparison page): request an account, sign in if you already have
 * one, or get the phone app if your organization already set you up. The
 * request form itself lives here, inline. While self-service signup is open
 * (MUT-369), "Create an account" comes first and the form stays, below, for
 * those who want us to set it up (D6); while it is closed the form comes first
 * and the ways in for existing users follow it. DOM order is the visual order,
 * so focus follows the page.
 */
export function GetItSection({ signupUrl = null }: { signupUrl?: string | null }) {
  const t = useT();
  const portalUrl = hostedPortalUrl();
  const iosUrl = storeLinkUrl(MOBILE_APP_LINKS.ios, 'mutaba3a-landing');
  const androidUrl = storeLinkUrl(MOBILE_APP_LINKS.android, 'mutaba3a-landing');
  const open = Boolean(signupUrl);

  const options = (
    <div className="landing-get-it-options">
      {signupUrl && <OptionTile href={signupUrl} label={t('landing.getIt.createCta')} primary />}
      {portalUrl && <OptionTile href={portalUrl} icon={<BrowserIcon size={22} />} label={t('landing.getIt.signInCta')} />}
      {(iosUrl || androidUrl) && (
        <div className="landing-get-it-apps">
          <span className="landing-get-it-apps-label">{t('landing.getIt.appsLabel')}</span>
          {iosUrl && <OptionTile href={iosUrl} icon={<IosIcon size={22} />} label={t('landing.getIt.appsIos')} />}
          {androidUrl && <OptionTile href={androidUrl} icon={<AndroidIcon size={22} />} label={t('landing.getIt.appsAndroid')} />}
        </div>
      )}
    </div>
  );
  const note = <p className="landing-get-it-note">{t(open ? 'landing.getIt.noteOpen' : 'landing.getIt.note')}</p>;

  return (
    <section id="get-it" data-part="get-it" aria-labelledby="get-it-title" className="landing-section landing-get-it">
      <div className="landing-container">
        <h2 id="get-it-title" className="landing-section-headline">
          {t('landing.getIt.title')}
        </h2>
        <p className="landing-get-it-lead">{t('landing.getIt.lead')}</p>

        <div className="landing-get-it-body">
          {open && options}
          {open && note}

          <div className="landing-get-it-request" data-part="get-it-request">
            <h3 id="get-it-request-title" className="landing-get-it-request-title">
              {t(open ? 'landing.getIt.requestCtaOpen' : 'landing.getIt.requestCta')}
            </h3>
            <p className="landing-get-it-request-hint">{t('landing.getIt.requestHint')}</p>
            <HostedRequestForm titleId="get-it-request-title" />
          </div>

          {!open && options}
          {!open && note}
        </div>
      </div>
    </section>
  );
}
