import { useT } from '../../lib/i18n/core';
import type { ProfileType } from '../api/client';

/**
 * Personal | Business as two native radio cards (design review Issue 7). Not
 * `SegmentedControl`: that needs a selected value, and a new profile's type
 * starts unchosen (eng review R5). Each card says what it seeds, so the choice
 * that is costly to change later is made knowingly.
 */

const TYPES: readonly { value: ProfileType; label: string; seed: string }[] = [
  { value: 'PERSONAL', label: 'hosted.profiles.kind.personal', seed: 'hosted.profiles.seed.personal' },
  { value: 'BUSINESS', label: 'hosted.profiles.kind.business', seed: 'hosted.profiles.seed.business' },
];

export interface ProfileTypeCardsProps {
  name: string;
  value: ProfileType | '';
  onChange: (value: ProfileType) => void;
  labelledBy: string;
  describedBy?: string;
  invalid?: boolean;
  /** MUT-373: a card that can't be chosen here (a shared profile stays Business), explained at the card, not after Save. */
  disabled?: { value: ProfileType; reason: string };
}

export function ProfileTypeCards({ name, value, onChange, labelledBy, describedBy, invalid, disabled }: ProfileTypeCardsProps) {
  const t = useT();
  return (
    <div className="hp-type-cards" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
      {TYPES.map((type) => {
        const off = disabled?.value === type.value;
        return (
          <label key={type.value} className={`hp-type-card ${value === type.value ? 'hp-type-card-on' : ''} ${off ? 'hp-type-card-off' : ''}`}>
            <input type="radio" name={name} value={type.value} checked={value === type.value} disabled={off} onChange={() => onChange(type.value)} />
            <span className="hp-type-card-text">
              <span className="hp-type-card-label">{t(type.label)}</span>
              <span className="hp-type-card-seed">{off ? disabled.reason : t(type.seed)}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
