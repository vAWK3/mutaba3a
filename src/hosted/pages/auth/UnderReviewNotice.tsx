import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import { SUPPORT_EMAIL } from '../../terms';
import { meQuery } from '../../session/me';
import { useMode } from '../../session/mode';
import { useSignOut } from '../../session/useSignOut';
import { AuthLayout } from './AuthLayout';

/**
 * The under-review screen (MUT-367/368): a signup on webmail or an unverified domain waits for the operator, and its
 * password signs in to 403 ACCOUNT_UNDER_REVIEW. It says what happens next and when. Sign out ends a session someone
 * already has on this browser (D16, asked of the server as sign-in does); with none, `onLeave` gives back an empty
 * sign-in page.
 */
export function UnderReviewNotice({ onLeave }: { onLeave: () => void }) {
  const t = useT();
  const remote = useMode() === 'remote';
  const session = useQuery({ ...meQuery, enabled: remote });
  const signedIn = remote && Boolean(session.data);
  const { signOut, signingOut } = useSignOut();
  return (
    <AuthLayout>
      <section className="hp-card hp-signin-card" role="status">
        <h1>{t('hosted.underReview.title')}</h1>
        <p className="hp-setup-lead">{t('hosted.underReview.body')}</p>
        <p className="hp-field-hint">
          {t('hosted.underReview.help')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>
            <bdi>{SUPPORT_EMAIL}</bdi>
          </a>
        </p>
        <button type="button" className="btn btn-secondary btn-md hp-block" disabled={signingOut} onClick={() => (signedIn ? void signOut() : onLeave())}>
          {t('hosted.auth.signOut')}
        </button>
      </section>
    </AuthLayout>
  );
}
