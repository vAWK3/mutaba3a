import { useCallback, useState } from 'react';
import { Link, Navigate } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { useT } from '../../../lib/i18n/core';
import { ApiError, type HostedProfile, type IssuerDetails, type IssuingSetup } from '../../api/client';
import { Skeleton } from '../../components/QueryView';
import { useIntroSeen, useIssuer, useIssuerLogoUrl, useIssuingCounters, useIssuingSetup } from '../../data/issuingQueries';
import { useWritableFor } from '../../session/me';
import { youPath } from '../../shell/youRoutes';
import { isolate } from '../sharing/sharingRules';
import { DefaultsStep, DetailsStep, LogoStep, NumberingStep, TaxAuthorityStep } from './InvoicingSteps';
import { IntroArt, ReadyArt } from './InvoicingArt';
import { Letterhead } from './Letterhead';
import { DEFAULT_INK, REQUIRED_STEPS, SETUP_STEPS, type PaperModel, type SetupStep } from './setupSteps';

/**
 * MUT-646: You › Profiles › Invoicing (round 3, variant 2). First visit: three cards on what issuing means, then the
 * setup: the letterhead at full size, its numbered regions the five steps, the current step's fields beside it. Each
 * step saves on its own; the progress is the server's (GET /v1/issuing/setup), which also decides whether issuing is
 * open. A profile without issuing (the owner's feature off, signed out) has no such page: back to Profiles.
 */
export function InvoicingSetupPage({ profile }: { profile: HostedProfile }) {
  const t = useT();
  const setup = useIssuingSetup(profile.id);
  const issuer = useIssuer(profile.id);
  if (setup.error instanceof ApiError && setup.error.status === 404) return <Navigate to={youPath(profile.id, 'profiles')} replace />;
  const ready = setup.data && issuer.data !== undefined;
  // Review fix: a failed read says so and offers a retry, never an endless skeleton.
  const failed = (setup.error && !(setup.error instanceof ApiError && setup.error.status === 404)) || issuer.error;
  // Only an owner changes the setup (the server refuses anyone else); a reader sees the letterhead, never the intro.
  const owner = profile.owned === true;

  return (
    <div className="hp-setup">
      <Link className="hp-link hp-sharing-back" to={youPath(profile.id, 'profiles')}>
        <span className="hp-sharing-back-arrow" aria-hidden="true">
          ‹
        </span>{' '}
        {t('hosted.sharing.back')}
      </Link>
      <h1 className="hp-sharing-title">{t('hosted.invoicing.title', { profile: isolate(profile.name) })}</h1>
      <p className="hp-sharing-note">{t('hosted.invoicing.note')}</p>
      {failed ? (
        <div className="hp-setup-failed" role="alert">
          <p>{t('hosted.invoicing.loadFailed')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void setup.refetch();
              void issuer.refetch();
            }}
          >
            {t('hosted.invoicing.retry')}
          </Button>
        </div>
      ) : !ready ? (
        <Skeleton />
      ) : owner && !setup.data.introSeen ? (
        <Intro profileId={profile.id} />
      ) : (
        <Workspace profile={profile} setup={setup.data} issuer={issuer.data ?? null} owner={owner} />
      )}
    </div>
  );
}

function Intro({ profileId }: { profileId: string }) {
  const t = useT();
  const seen = useIntroSeen(profileId);
  const cards = [
    ['issue', 'whatTitle', 'whatBody'],
    ['final', 'finalTitle', 'finalBody'],
    ['allocation', 'allocationTitle', 'allocationBody'],
  ] as const;
  return (
    <section className="hp-setup-intro" aria-labelledby="hp-setup-intro-title">
      <h2 id="hp-setup-intro-title">{t('hosted.invoicing.intro.title')}</h2>
      <ol className="hp-setup-cards">
        {cards.map(([art, title, body]) => (
          <li key={title} className="hp-setup-card">
            <IntroArt name={art} />
            <h3>{t(`hosted.invoicing.intro.${title}`)}</h3>
            <p>{t(`hosted.invoicing.intro.${body}`)}</p>
          </li>
        ))}
      </ol>
      <Button onClick={() => seen.mutate()} disabled={seen.isPending}>
        {t('hosted.invoicing.intro.begin')}
      </Button>
    </section>
  );
}

const doneSteps = (setup: IssuingSetup): Set<SetupStep> => new Set(SETUP_STEPS.filter((step) => setup.steps[step] === 'done'));

function paperOf(issuer: IssuerDetails | null, logoUrl: string | null, nextNumber: number): PaperModel {
  return {
    legalName: issuer?.legalName ?? '',
    vatId: issuer?.vatId ?? '',
    dealerType: issuer?.dealerType ?? 'LICENSED',
    address: issuer?.address ?? '',
    city: issuer?.city ?? '',
    phone: issuer?.phone ?? '',
    email: issuer?.email ?? '',
    style: (issuer?.documentStyle ?? 'PROFESSIONAL') as PaperModel['style'],
    ink: (issuer?.ink ?? DEFAULT_INK) as PaperModel['ink'],
    language: (issuer?.defaultLanguage ?? 'he') as PaperModel['language'],
    bankDetails: issuer?.bankDetails ?? '',
    footerNote: issuer?.footerNote ?? '',
    logoUrl,
    nextNumber,
  };
}

function Workspace({ profile, setup, issuer, owner }: { profile: HostedProfile; setup: IssuingSetup; issuer: IssuerDetails | null; owner: boolean }) {
  const t = useT();
  const writable = useWritableFor(profile) && owner;
  const counters = useIssuingCounters(profile.id);
  const logoUrl = useIssuerLogoUrl(profile.id, setup.hasLogo);
  const done = doneSteps(setup);
  // Opens on the first step still to do; picking a region (or a step's Next) moves it.
  const [current, setCurrent] = useState<SetupStep>(() => (new URLSearchParams(window.location.search).has('taxAuthority') ? 'taxAuthority' : (SETUP_STEPS.find((step) => setup.steps[step] === 'todo') ?? 'details')));
  // What the open step's form holds, over what is saved: the letterhead follows the typing (AC3).
  const [draft, setDraft] = useState<Partial<PaperModel>>({});
  const nextNumber = counters.data?.counters.find((c) => c.docType === 'TAX_INVOICE')?.next ?? 1;
  const model = { ...paperOf(issuer, logoUrl, nextNumber), ...draft, logoUrl };

  const go = (step: SetupStep) => {
    setDraft({});
    setCurrent(step);
  };
  const advance = () => go(SETUP_STEPS[SETUP_STEPS.indexOf(current) + 1] ?? 'taxAuthority');
  const preview = useCallback((patch: Partial<PaperModel>) => setDraft((d) => ({ ...d, ...patch })), []);
  const n = SETUP_STEPS.indexOf(current) + 1;
  const stepProps = { profileId: profile.id, onPreview: preview, onDone: advance };

  return (
    <div className="hp-setup-columns">
      <Letterhead model={model} current={current} done={done} onPick={go} />
      <section className="hp-setup-panel" aria-labelledby="hp-setup-step-title">
        <p className="hp-setup-progress" role="status" data-testid="setup-progress">
          {t('hosted.invoicing.progress', { done: String(done.size) })}
        </p>
        <Status setup={setup} />
        <p className="hp-setup-eyebrow">
          {t('hosted.invoicing.stepOf', { n: String(n) })} · {t(REQUIRED_STEPS.has(current) ? 'hosted.invoicing.required' : 'hosted.invoicing.optional')}
          {done.has(current) && ` · ${t('hosted.invoicing.complete')}`}
        </p>
        <h2 id="hp-setup-step-title">{t(`hosted.invoicing.steps.${current}`)}</h2>
        {!writable ? (
          <p className="hp-muted">{t('hosted.invoicing.readOnly')}</p>
        ) : current === 'details' ? (
          <DetailsStep {...stepProps} issuer={issuer} />
        ) : current === 'logo' ? (
          <LogoStep {...stepProps} hasLogo={setup.hasLogo} />
        ) : current === 'defaults' ? (
          <DefaultsStep {...stepProps} issuer={issuer} />
        ) : current === 'numbering' ? (
          <NumberingStep {...stepProps} answered={setup.steps.numbering === 'done'} counters={counters.data} />
        ) : (
          <TaxAuthorityStep profileId={profile.id} onDone={() => go(SETUP_STEPS.find((step) => setup.steps[step] === 'todo' && REQUIRED_STEPS.has(step)) ?? 'taxAuthority')} />
        )}
      </section>
    </div>
  );
}

/** AC1: whether issuing is open, and if not, which required steps hold it. */
function Status({ setup }: { setup: IssuingSetup }) {
  const t = useT();
  if (setup.canIssue) {
    return (
      <div className="hp-setup-ready" role="status" data-testid="setup-ready">
        <ReadyArt />
        <strong>{t('hosted.invoicing.ready.title')}</strong>
        <span>{t('hosted.invoicing.ready.body')}</span>
      </div>
    );
  }
  const steps = setup.missing.map((m) => t(`hosted.invoicing.steps.${m === 'DETAILS' ? 'details' : 'numbering'}`)).join(' · ');
  return (
    <p className="hp-setup-blocked" data-testid="setup-blocked">
      {t('hosted.invoicing.blocked', { steps })}
    </p>
  );
}
