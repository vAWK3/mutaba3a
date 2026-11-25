import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { isolate } from '../../lib/utils';
import { api, type DocumentsPreference, type HostedProfile } from '../api/client';
import { profileKey } from '../session/me';
import { Drawer } from './Drawer';

/**
 * MUT-661 (ADR-280): the one-time question after the first income saved for a client with no documents preference.
 * Four choices, each saving on the client and closing (never asked again); "Not now" leaves it unset (asked at the next
 * income, the profile default meanwhile). Read-then-write: the client's version is read fresh, since the one the save
 * toast knew may be old. A failed save keeps the drawer open with the message, the choices still there.
 */
export const ASK_CHOICES: readonly DocumentsPreference[] = ['TAX_INVOICE_FIRST', 'PAYMENT_REQUEST_FIRST', 'ON_PAYMENT', 'NO_DOCUMENT'];

export interface PreferenceAsk {
  customerId: string;
  customerName: string;
  /** Runs once the answer is saved, with it (the next action follows it). */
  onAnswered: (preference: DocumentsPreference) => void;
}

export function DocumentsPreferenceAsk({ profile, ask, onClose }: { profile: HostedProfile; ask: PreferenceAsk; onClose: () => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<DocumentsPreference | null>(null);
  const [failed, setFailed] = useState(false);

  const choose = async (documentsPreference: DocumentsPreference) => {
    if (saving) return;
    setSaving(documentsPreference);
    setFailed(false);
    try {
      const client = await api.customer(profile.id, ask.customerId);
      await api.updateCustomer(profile.id, ask.customerId, client.version, { documentsPreference });
      for (const key of [['directory', 'customers'], ['customer', ask.customerId], ['documents-due']] as const) void queryClient.invalidateQueries({ queryKey: profileKey(profile.id, ...key) });
      onClose();
      ask.onAnswered(documentsPreference);
    } catch {
      setFailed(true);
      setSaving(null);
    }
  };

  return (
    <Drawer
      title={t('hosted.issue.ask.title', { client: isolate(ask.customerName) })}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('hosted.issue.ask.later')}
          </Button>
        </div>
      }
    >
      <p className="hp-muted">{t('hosted.issue.ask.body')}</p>
      <div className="hp-ask-choices" role="group" aria-label={t('hosted.issue.ask.title', { client: isolate(ask.customerName) })}>
        {ASK_CHOICES.map((choice) => (
          <button key={choice} type="button" className="hp-ask-choice" disabled={saving !== null} aria-busy={saving === choice || undefined} onClick={() => void choose(choice)} data-testid={`ask-${choice}`}>
            <span className="hp-ask-choice-name">{t(`hosted.client.documents.choices.${choice}`)}</span>
            <span className="hp-muted">{t(`hosted.issue.ask.hint.${choice}`)}</span>
          </button>
        ))}
      </div>
      {failed && (
        <p className="input-error-message" role="alert">
          {t('hosted.issue.ask.failed')}
        </p>
      )}
    </Drawer>
  );
}
