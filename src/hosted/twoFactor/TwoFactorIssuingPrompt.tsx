import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { AlertIcon } from '../components/Icons';
import { useMeOrNull } from '../session/me';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { setupRequiredOf } from './twoFactor';

/**
 * The prompt before issuing (MUT-710 D10, wireframe "Before issuing"): issuing, connecting to the Tax Authority and the
 * business details sent to it need two-step sign-in, and this session must have passed it. The prompt says why before
 * the person tries when the account already shows it's needed (Me `requiredForIssuing` with it off), and otherwise as
 * soon as the server refuses (403 TWO_FACTOR_SETUP_REQUIRED). "Set up" opens the drawer over this one (`?twoFactor=true`),
 * so nothing written here is lost.
 */
export function TwoFactorIssuingPrompt({ error }: { error?: unknown }) {
  // Outside the authenticated routes (a step rendered on its own) only a refusal can say it's needed.
  const state = useMeOrNull()?.user.twoFactor;
  const refused = setupRequiredOf(error);
  const needed = refused !== null || (state?.requiredForIssuing === true && !state.enabled);
  // Nothing to say: no router hooks either, so a step rendered outside the shell (its tests) needs none.
  if (!needed) return null;
  return <Prompt enrolled={refused?.enrolled === true} />;
}

function Prompt({ enrolled }: { enrolled: boolean }) {
  const t = useT();
  const drawers = useAccountDrawers();
  // On, but this session was opened before it: only signing in again stamps it (D10 `enrolled`).
  if (enrolled) {
    return (
      <div className="hp-banner hp-banner-warning" role="alert" data-testid="two-factor-issuing-prompt">
        <AlertIcon />
        <span>{t('hosted.twoFactor.issuing.signInAgain')}</span>
      </div>
    );
  }
  return (
    <div className="hp-banner hp-banner-warning hp-two-factor-prompt" role="alert" data-testid="two-factor-issuing-prompt">
      <AlertIcon />
      <div>
        <p>
          <b>{t('hosted.twoFactor.issuing.title')}</b>
        </p>
        <Button type="button" size="sm" onClick={drawers.openTwoFactor}>
          {t('hosted.twoFactor.issuing.setUp')}
        </Button>
      </div>
    </div>
  );
}
