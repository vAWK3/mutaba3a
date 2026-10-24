import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import { api } from '../../api/client';
import { selfServiceQuery } from '../../session/selfServiceDoors';
import { termsHref } from '../../terms';
import { AuthLayout } from './AuthLayout';
import { CheckingSession } from './BootScreens';
import { CheckEmailNotice, SentenceWithEmail } from './CheckEmailNotice';
import { EmailLinkForm } from './EmailLinkForm';
import { SignedOutOnly } from './SignedOutOnly';

/**
 * `/signup` (MUT-368, ADR-159 §3): an email and the bot check, then "Check your email". The link in the mail opens
 * /setup, which creates the account. While the server has signup off, the page says accounts are by request and
 * links to the landing's request form.
 */

type Phase = { kind: 'form'; email: string } | { kind: 'sent'; email: string; sentAt: number } | { kind: 'closed' };

/** The landing's /hosted request form (ADR-076 build value; tests define none). */
function hostedOfferHref(): string {
  return typeof __HOSTED_OFFER_URL__ !== 'undefined' ? __HOSTED_OFFER_URL__ : '';
}

export function SignupPage() {
  return (
    <SignedOutOnly>
      <Signup />
    </SignedOutOnly>
  );
}

function Signup() {
  const t = useT();
  const { language } = useLanguage();
  const doors = useQuery(selfServiceQuery);
  const [phase, setPhase] = useState<Phase>({ kind: 'form', email: '' });

  if (doors.isPending) return <CheckingSession />;
  if (doors.isError) return <DoorsUnreachable onRetry={() => void doors.refetch()} retrying={doors.isFetching} />;
  if (!doors.data.signup || phase.kind === 'closed') return <SignupClosed />;

  const termsLink = termsHref(language);
  return (
    <AuthLayout>
      {phase.kind === 'sent' ? (
        <CheckEmailNotice
          title={t('hosted.signup.sent.title')}
          body={<SentenceWithEmail sentence={t('hosted.signup.sent.body')} email={phase.email} />}
          sentAt={phase.sentAt}
          onSendAgain={() => setPhase({ kind: 'form', email: phase.email })}
        />
      ) : (
        <EmailLinkForm
          action="signup"
          title={t('hosted.signup.title')}
          lead={t('hosted.signup.lead')}
          submitLabel={t('hosted.signup.submit')}
          initialEmail={phase.email}
          send={api.signup}
          onSent={(email) => setPhase({ kind: 'sent', email, sentAt: Date.now() })}
          onClosed={() => setPhase({ kind: 'closed' })}
        >
          <p className="hp-field-hint">
            {t('hosted.signup.terms')}{' '}
            {termsLink && (
              <a href={termsLink} target="_blank" rel="noopener">
                {t('hosted.signup.termsLink')}
              </a>
            )}
          </p>
        </EmailLinkForm>
      )}
      <HaveAnAccount />
    </AuthLayout>
  );
}

/** The way back to sign-in under every self-service screen: "Already have an account? Sign in", or just "Back". */
export function HaveAnAccount({ back = false }: { back?: boolean }) {
  const t = useT();
  if (back) {
    return (
      <p className="hp-help">
        <Link to="/sign-in">{t('hosted.selfService.toSignIn')}</Link>
      </p>
    );
  }
  return (
    <p className="hp-help">
      {t('hosted.selfService.haveAccount')} <Link to="/sign-in">{t('hosted.selfService.signIn')}</Link>
    </p>
  );
}

function SignupClosed() {
  const t = useT();
  const offer = hostedOfferHref();
  return (
    <AuthLayout>
      <section className="hp-card hp-signin-card">
        <h1>{t('hosted.signup.closed.title')}</h1>
        <p className="hp-setup-lead">{t('hosted.signup.closed.body')}</p>
        {offer && (
          <a className="btn btn-primary btn-md hp-block" href={offer}>
            {t('hosted.signup.closed.link')}
          </a>
        )}
      </section>
      <HaveAnAccount />
    </AuthLayout>
  );
}

/** GET /v1/self-service got no answer: say so, rather than claim signup is closed (review P2-10). */
export function DoorsUnreachable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const t = useT();
  return (
    <AuthLayout>
      <section className="hp-card hp-signin-card" role="alert">
        <h1>{t('hosted.auth.boot.title')}</h1>
        <p className="hp-setup-lead">{t('hosted.auth.unreachable')}</p>
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          {t('hosted.auth.boot.retry')}
        </Button>
      </section>
      <HaveAnAccount />
    </AuthLayout>
  );
}
