import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { usePilot, usePilotWelcomeSeen } from '../data/pilotQueries';
import { formatLongDay } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { useMe, useOptionalProfile } from '../session/me';
import { Drawer } from './Drawer';
import { Scene, type SceneName } from './Scene';

/**
 * MUT-755 (plan T4, design review 3B, journey step 2): the pilot Welcome, once per account. A drawer by URL key
 * (`?pilotWelcome=true`, drawer-first): "Business, free until <date>", then three steps, each on its scene
 * (`pilot-welcome-1..3`), rising in with `motion-pilot-sheet` (the drawer's own entrance stands for the sheet's).
 * Later, ✕ and the main action all close it and tell the server (`POST /v1/billing/pilot-welcome`), so it never opens
 * again, on any device, also after an extension. The main action goes to Receipts, the web's scan.
 */

const STEPS: readonly { scene: SceneName; key: string }[] = [
  { scene: 'pilot-welcome-1', key: 'scan' },
  { scene: 'pilot-welcome-2', key: 'invoice' },
  { scene: 'pilot-welcome-3', key: 'tell' },
];

export function PilotWelcomeDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const { pilot, settled } = usePilot();
  const seen = usePilotWelcomeSeen();
  const navigate = useNavigate();
  const receiptsProfileId = useReceiptsProfileId();
  // Kept from the first read: closing marks it seen in the cache, and the drawer must not change under the person.
  const [shown, setShown] = useState(pilot);
  if (shown === null && pilot) setShown(pilot);
  const nothingToShow = settled && (shown === null || shown.welcomeSeenAt !== null);

  // A deep link with no pilot, or one already welcomed, closes on its own.
  useEffect(() => {
    if (nothingToShow) onClose();
  }, [nothingToShow, onClose]);
  if (!shown || nothingToShow) return null;

  const close = () => {
    if (!seen.isPending && !seen.isSuccess) seen.mutate();
    onClose();
  };
  const start = () => {
    if (!seen.isPending && !seen.isSuccess) seen.mutate();
    if (receiptsProfileId) void navigate({ to: '/p/$profileId/expenses/receipts', params: { profileId: receiptsProfileId } } as never);
    else onClose();
  };

  return (
    <Drawer
      title={t('hosted.pilotWelcome.title')}
      onClose={close}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button variant="secondary" onClick={close}>
            {t('hosted.pilotWelcome.later')}
          </Button>
          <Button variant="primary" onClick={start}>
            {t('hosted.pilotWelcome.start')}
          </Button>
        </div>
      }
    >
      <div className="hp-pilot-welcome" data-testid="pilot-welcome">
        <p className="hp-pilot-welcome-lead">{t('hosted.pilotWelcome.lead', { plan: t('hosted.plan.name.business'), date: formatLongDay(shown.endsAt, language, browserTimezone()) })}</p>
        <ol className="hp-pilot-welcome-steps">
          {STEPS.map((step, i) => (
            <li key={step.key} className={`hp-pilot-welcome-step hp-pilot-welcome-step-${i + 1}`}>
              <Scene name={step.scene} size={120} />
              <span>{t(`hosted.pilotWelcome.steps.${step.key}`)}</span>
            </li>
          ))}
        </ol>
      </div>
    </Drawer>
  );
}

/** Receipts of the open profile, else the person's own default profile (a profile is always there when signed in). */
function useReceiptsProfileId(): string | null {
  const me = useMe();
  const open = useOptionalProfile();
  if (open) return open.id;
  return (me.profiles.find((p) => p.isPersonalDefault) ?? me.profiles[0])?.id ?? null;
}
