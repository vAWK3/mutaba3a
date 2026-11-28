import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { api } from '../api/client';
import { BILLING_KEY } from '../data/billingQueries';
import { ME_KEY } from '../session/me';

export interface ChecklistBusiness {
  id: string;
  name: string;
}

/**
 * MUT-705 / MUT-734 (wireframe mut-734 "keep", variant A): which businesses stay active when the plan keeps fewer than
 * the person owns. Checkboxes with an "N of N" counter; nothing is ticked first (Basel, MUT-731 Q5); once the count
 * reaches the cap the other rows stop taking ticks; each unticked row says what happens to it (`offLabel`).
 */
export function BusinessChecklist({ businesses, cap, chosen, onChange, offLabel }: { businesses: ChecklistBusiness[]; cap: number; chosen: string[]; onChange: (ids: string[]) => void; offLabel: string }) {
  const t = useT();
  const headingId = useId();
  const full = chosen.length >= cap;
  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : full ? chosen : [...chosen, id]);
  return (
    <div className="hp-keep" data-testid="business-checklist">
      <div className="hp-keep-head">
        <span id={headingId} className="hp-keep-title">
          {t('hosted.billing.keep.title')}
        </span>
        <span className="hp-keep-count" data-full={chosen.length === cap || undefined} aria-live="polite">
          <bdi>{t('hosted.billing.keep.count', { chosen: String(chosen.length), cap: String(cap) })}</bdi>
        </span>
      </div>
      <div className="hp-keep-list" role="group" aria-labelledby={headingId}>
        {businesses.map((b) => {
          const on = chosen.includes(b.id);
          return (
            <label key={b.id} className="hp-keep-row" data-on={on || undefined} data-testid="keep-business">
              <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(b.id)} />
              <span className="hp-keep-name">
                <bdi dir="auto">{b.name}</bdi>
                {!on && <span className="hp-keep-off">{offLabel}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * MUT-705: Billing's "Choose which businesses stay active" pane on a paid plan that keeps fewer than the person owns.
 * Saves the pick (PUT /v1/billing/active-businesses) and refetches /v1/me and Billing, so every screen agrees.
 */
export function PickActiveBusinesses({ businesses, cap, initial, onDone }: { businesses: ChecklistBusiness[]; cap: number; initial: string[]; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState(initial.slice(0, cap));
  const save = useMutation({
    mutationFn: (ids: string[]) => api.setActiveBusinesses(ids),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ME_KEY }), queryClient.invalidateQueries({ queryKey: BILLING_KEY })]),
  });
  return (
    <div className="hp-pick-business">
      <BusinessChecklist businesses={businesses} cap={cap} chosen={chosen} onChange={setChosen} offLabel={t('hosted.billing.chip.readOnly')} />
      {save.isError && (
        <p className="hp-field-error" role="alert">
          {t('hosted.billing.states.loadFailed')}
        </p>
      )}
      <div className="hp-pick-actions">
        <span />
        <Button disabled={chosen.length !== cap} isLoading={save.isPending} keepLabelWhileLoading data-testid="keep-confirm" onClick={() => save.mutate(chosen, { onSuccess: onDone })}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * MUT-705 (AC5): on a paid plan that keeps fewer businesses than the person owns, Billing lists the read-only ones with
 * the reason (the plan's count) and the way out.
 */
export function ReadOnlyBusinesses({ names, planLine, onChoose }: { names: string[]; planLine: string; onChoose: () => void }) {
  const t = useT();
  return (
    <section className="hp-billing-plan hp-billing-profiles" aria-labelledby="hp-paid-read-only" data-testid="read-only-businesses">
      <h4 id="hp-paid-read-only">{t('hosted.billing.chip.readOnly')}</h4>
      <p className="hp-starter-fine">{planLine}</p>
      <ul>
        {names.map((name, i) => (
          <li key={`${name}-${i}`}>
            <bdi dir="auto">{name}</bdi>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="hp-link-button" onClick={onChoose}>
          {t('hosted.billing.keep.choose')}
        </button>
      </div>
    </section>
  );
}
