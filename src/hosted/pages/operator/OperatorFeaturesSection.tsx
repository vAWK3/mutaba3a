import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import { api, ApiError, apiErrorReason, type OperatorAccount } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { RowGroup, RowSwitch } from '../../components/YouRows';
import { patchOperatorAccount } from '../../data/operatorQueries';
import { useFeatureText } from '../../operator/featureNames';
import { OperatorConfirm, StepUpFailureBanner, useOperatorRun } from '../../operator/OperatorStepUp';
import { isolated } from '../../operator/text';
import { ME_KEY } from '../../session/me';

/**
 * MUT-462 (design 15A): the person's feature flags, one switch per flag the server has (`availableFeatures`). Turning
 * one on acts straight away (busy while saving; a failure turns it back with the reason in the row). Turning one off
 * takes something away, so it confirms in the row first. Both go through the operator step-up.
 *
 * MUT-527: the operator's own account switches too (the E10 amendment), here and on the console's You panel; a flag
 * the portal has no words for shows a humanised name, never its key.
 */
export function OperatorFeaturesSection({ account, stepUpUntil, label }: { account: OperatorAccount; stepUpUntil: string | null; label?: string }) {
  const t = useT();
  return (
    <RowGroup label={label ?? t('hosted.operator.features.title')}>
      {account.availableFeatures.map((feature) => (
        <FeatureRow key={feature} account={account} feature={feature} stepUpUntil={stepUpUntil} />
      ))}
    </RowGroup>
  );
}

function FeatureRow({ account, feature, stepUpUntil }: { account: OperatorAccount; feature: string; stepUpUntil: string | null }) {
  const t = useT();
  const text = useFeatureText()(feature);
  const queryClient = useQueryClient();
  const run = useOperatorRun(stepUpUntil);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const on = account.features.includes(feature);

  async function set(next: boolean) {
    setRefusal(null);
    try {
      const result = await run.run(() => api.setOperatorFeature(account.id, feature, next));
      if (!result) return;
      patchOperatorAccount(queryClient, account.id, { features: next ? [...account.features.filter((f) => f !== feature), feature] : account.features.filter((f) => f !== feature) });
      setConfirmingOff(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
        return;
      }
      const reason = error instanceof ApiError ? apiErrorReason(error) : undefined;
      if (reason === 'USER_PENDING_REVIEW') setRefusal(t('hosted.operator.features.pendingRefused'));
      // An API from before MUT-527 still refuses the operator's own flags.
      else if (reason === 'OWN_ACCOUNT') setRefusal(t('hosted.operator.accounts.ownRefused'));
      else run.setFailure('failed');
    }
  }

  if (confirmingOff) {
    return (
      <div className="hp-operator-confirm">
        <OperatorConfirm
          text={text.confirmOff(isolated(account.email))}
          labels={{ plain: t('hosted.operator.features.turnOff'), passkey: t('hosted.operator.features.turnOffWithPasskey') }}
          variant="danger"
          run={run}
          error={refusal && <Refusal text={refusal} />}
          onConfirm={() => void set(false)}
          onCancel={() => {
            run.clear();
            setRefusal(null);
            setConfirmingOff(false);
          }}
        />
      </div>
    );
  }

  return (
    <div data-feature-row={feature}>
      <RowSwitch label={text.label} sub={text.sub} on={on} busy={run.busy} onToggle={() => (on ? setConfirmingOff(true) : void set(true))} />
      {run.failure && <StepUpFailureBanner failure={run.failure} error={run.failureError} />}
      {run.label === 'confirm' && !on && <p className="hp-you-row hp-you-row--note">{t('hosted.operator.features.tapAgain')}</p>}
      {refusal && <Refusal text={refusal} />}
    </div>
  );
}

function Refusal({ text }: { text: string }) {
  return (
    <div className="hp-banner hp-banner-error" role="alert">
      <AlertIcon />
      <span>{text}</span>
    </div>
  );
}
