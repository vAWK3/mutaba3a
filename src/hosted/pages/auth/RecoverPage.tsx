import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import { api } from '../../api/client';
import { selfServiceQuery } from '../../session/selfServiceDoors';
import { SUPPORT_EMAIL } from '../../terms';
import { AuthLayout } from './AuthLayout';
import { CheckingSession } from './BootScreens';
import { CheckEmailNotice, SentenceWithEmail } from './CheckEmailNotice';
import { EmailLinkForm } from './EmailLinkForm';
import { SignedOutOnly } from './SignedOutOnly';
import { DoorsUnreachable, HaveAnAccount } from './SignupPage';

/**
 * `/recover` (MUT-368, ADR-159 §4): "Forgot your password?". An email and the bot check, then the same "If that
 * address has an account…" screen for every address. The link in the mail opens /setup (RESET, or SETUP for an
 * account that never set a password). Nothing changes until the link is used (ADR-088 §3).
 */

type Phase = { kind: 'form'; email: string } | { kind: 'sent'; email: string; sentAt: number };

export function RecoverPage() {
  return (
    <SignedOutOnly>
      <Recover />
    </SignedOutOnly>
  );
}

function Recover() {
  const t = useT();
  const doors = useQuery(selfServiceQuery);
  const [phase, setPhase] = useState<Phase>({ kind: 'form', email: '' });

  if (doors.isPending) return <CheckingSession />;
  if (doors.isError) return <DoorsUnreachable onRetry={() => void doors.refetch()} retrying={doors.isFetching} />;
  if (!doors.data.recovery) return <RecoveryUnavailable />;

  return (
    <AuthLayout>
      {phase.kind === 'sent' ? (
        <CheckEmailNotice
          title={t('hosted.recover.sent.title')}
          body={<SentenceWithEmail sentence={t('hosted.recover.sent.body')} email={phase.email} />}
          sentAt={phase.sentAt}
          onSendAgain={() => setPhase({ kind: 'form', email: phase.email })}
        />
      ) : (
        <EmailLinkForm
          action="recover"
          title={t('hosted.recover.title')}
          lead={t('hosted.recover.lead')}
          submitLabel={t('hosted.recover.submit')}
          initialEmail={phase.email}
          send={api.recoverAccount}
          onSent={(email) => setPhase({ kind: 'sent', email, sentAt: Date.now() })}
        />
      )}
      <HaveAnAccount back />
    </AuthLayout>
  );
}

/** This server mails no links yet (mail is off): recovery would only fail, so the page says who can help (D14). */
function RecoveryUnavailable() {
  const t = useT();
  return (
    <AuthLayout>
      <section className="hp-card hp-signin-card">
        <h1>{t('hosted.recover.unavailable.title')}</h1>
        <p className="hp-setup-lead">
          {t('hosted.recover.unavailable.body')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>
            <bdi>{SUPPORT_EMAIL}</bdi>
          </a>
        </p>
      </section>
      <HaveAnAccount back />
    </AuthLayout>
  );
}
