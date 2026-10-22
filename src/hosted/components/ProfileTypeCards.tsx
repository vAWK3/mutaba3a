import { useT } from '../../lib/i18n/core';
import type { ProfileType } from '../api/client';
import { RadioCards } from './RadioCards';

/**
 * Personal | Business as two native radio cards (design review Issue 7). Not
 * `SegmentedControl`: that needs a selected value, and a new profile's type
 * starts unchosen (eng review R5). Each card says what it seeds, so the choice
 * that is costly to change later is made knowingly. The cards themselves are
 * the shared `RadioCards` (MUT-362 DR9).
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

export function ProfileTypeCards(props: ProfileTypeCardsProps) {
  const t = useT();
  const options = TYPES.map((type) => ({ value: type.value, label: t(type.label), note: t(type.seed) }));
  return <RadioCards {...props} options={options} />;
}
