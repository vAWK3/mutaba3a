/**
 * Native radio cards: a label and a one-line note per choice, arrow keys between them (design review Issue 7, MUT-183).
 * Shared by New profile's Personal | Business and Billing's For yourself | For a business (MUT-362 design review DR9),
 * so the focus ring, RTL and disabled look stay one thing. The `hp-type-card` classes are the original component's.
 */

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  note: string;
}

export interface RadioCardsProps<T extends string> {
  name: string;
  options: readonly RadioCardOption<T>[];
  /** '' while nothing is chosen. */
  value: T | '';
  onChange: (value: T) => void;
  labelledBy: string;
  describedBy?: string;
  invalid?: boolean;
  /** A card that can't be chosen here, explained at the card itself in place of its note. */
  disabled?: { value: T; reason: string };
}

export function RadioCards<T extends string>({ name, options, value, onChange, labelledBy, describedBy, invalid, disabled }: RadioCardsProps<T>) {
  return (
    <div className="hp-type-cards" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
      {options.map((option) => {
        const off = disabled?.value === option.value;
        return (
          <label key={option.value} className={`hp-type-card ${value === option.value ? 'hp-type-card-on' : ''} ${off ? 'hp-type-card-off' : ''}`}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={off} onChange={() => onChange(option.value)} />
            <span className="hp-type-card-text">
              <span className="hp-type-card-label">{option.label}</span>
              <span className="hp-type-card-seed">{off ? disabled.reason : option.note}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
