import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useT } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { localBackend } from '../../api/client';
import { countWelcomeChoice } from '../../analytics/portalAnalytics';
import { useContinueOnThisDevice } from '../../session/continueOnThisDevice';
import { LocalUnavailable } from './BootScreens';

/**
 * What the welcome is answering (MUT-513): a first visit with nobody signed in, the same when the server couldn't be
 * reached (a Retry line under the account door, D7), or reopened from You › Account on this device ("Continue").
 */
export type WelcomeVariant = 'first' | 'offline' | 'reopened';

interface WelcomePageProps {
  variant: WelcomeVariant;
  onRetry?: () => void;
  retrying?: boolean;
}

/**
 * The portal's front door (MUT-513, ADR-230): what MTB3A is, then two doors, an account or this device. Layout, copy,
 * illustration and motion are the Claude Design "Portal Welcome" (WELCOME-SPEC.md); the motion lives in hosted.css.
 */
export function WelcomePage({ variant, onRetry, retrying = false }: WelcomePageProps) {
  const t = useT();
  const navigate = useNavigate();
  const continueOnThisDevice = useContinueOnThisDevice();
  const [opening, setOpening] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  /** This device's records must open before the choice is saved: a browser that blocks storage saves nothing. */
  async function tryHere() {
    if (variant === 'reopened') {
      void navigate({ to: '/' });
      return;
    }
    countWelcomeChoice('local');
    setOpening(true);
    try {
      await localBackend();
    } catch {
      setOpening(false);
      setUnavailable(true);
      return;
    }
    continueOnThisDevice({ remember: variant !== 'offline' });
  }

  if (unavailable) {
    return (
      <LocalUnavailable
        onRetry={() => {
          setUnavailable(false);
          void tryHere();
        }}
        onSignIn={() => void navigate({ to: '/sign-in' })}
      />
    );
  }

  return (
    <div className="hp-welcome" data-testid="welcome" data-variant={variant}>
      <header className="hp-welcome-top">
        <Wordmark />
        <LanguageSwitch />
      </header>
      <main className="hp-welcome-main">
        <WelcomeArt label={t('hosted.welcome.illustration')} />
        <div className="hp-welcome-content">
          <div className="hp-welcome-intro">
            <h1 className="hp-welcome-title">{t('hosted.welcome.title')}</h1>
            <p className="hp-welcome-lede">{t('hosted.welcome.lede')}</p>
          </div>
          <section className="hp-welcome-door hp-welcome-door-account" aria-labelledby="welcome-door-account">
            <div className="hp-welcome-door-head">
              <h2 id="welcome-door-account" className="hp-welcome-eyebrow">
                {t('hosted.welcome.account.eyebrow')}
              </h2>
              <p>{t('hosted.welcome.account.line')}</p>
            </div>
            <div className="hp-welcome-actions">
              <Link to="/sign-in" className="btn btn-primary btn-md" onClick={() => countWelcomeChoice('sign_in')}>
                {t('hosted.welcome.account.signIn')}
              </Link>
              <Link to="/signup" className="btn btn-md hp-welcome-tonal" onClick={() => countWelcomeChoice('signup')}>
                {t('hosted.welcome.account.create')}
              </Link>
            </div>
            {variant === 'offline' && (
              <p className="hp-welcome-offline" role="status">
                <span>{t('hosted.welcome.offline')}</span>
                <span aria-hidden="true">·</span>
                <button type="button" className="hp-link-button press" onClick={onRetry} disabled={retrying}>
                  {retrying ? t('hosted.welcome.retrying') : t('hosted.welcome.retry')}
                </button>
              </p>
            )}
          </section>
          <section className="hp-welcome-door hp-welcome-door-device" aria-labelledby="welcome-door-device">
            <h2 id="welcome-door-device" className="hp-welcome-eyebrow">
              {t('hosted.welcome.local.eyebrow')}
            </h2>
            <ul className="hp-welcome-points">
              <li>{t('hosted.welcome.local.point1')}</li>
              <li>{t('hosted.welcome.local.point2')}</li>
              <li>
                {t('hosted.welcome.local.point3Lead')}
                <strong>{t('hosted.welcome.local.point3Path')}</strong>
                {t('hosted.welcome.local.point3End')}
              </li>
              <li>{t('hosted.welcome.local.point4')}</li>
            </ul>
            <Button variant="secondary" className="hp-block" isLoading={opening} keepLabelWhileLoading onClick={() => void tryHere()}>
              {variant === 'reopened' ? t('hosted.welcome.local.continue') : t('hosted.welcome.local.try')}
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}

/**
 * The MUT-407 onboarding scene as Claude Design adapted it for the web: same 160×160 geometry and part ids. Colours are
 * theme tokens (the export's light and dark files are those tokens' values); the entrance and the one ambient cycle are
 * CSS (hosted.css, `.hp-welcome-art`), and RTL mirrors the whole scene so the path leads in reading direction.
 */
function WelcomeArt({ label }: { label: string }) {
  return (
    <div className="hp-welcome-art" role="img" aria-label={label}>
      <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
        <g className="hp-welcome-scene">
          <path className="hp-welcome-ground" d="M18 140H142" />
          <path className="hp-welcome-arch" d="M40 140V76a40 40 0 0 1 80 0v64" />
          <path className="hp-welcome-path" d="M70 140c2-14 18-18 20-34" />
          <circle className="hp-welcome-nuqta" cx="80" cy="70" r="10" />
          <circle className="hp-welcome-sparkle hp-welcome-sparkle-1" cx="24" cy="54" r="3" />
          <path className="hp-welcome-sparkle hp-welcome-sparkle-2" d="M138 34v10M133 39h10" />
          <circle className="hp-welcome-sparkle hp-welcome-sparkle-3" cx="140" cy="96" r="3" />
        </g>
      </svg>
    </div>
  );
}
