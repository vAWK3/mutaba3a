import { useMemo, type Ref } from 'react';
import { Select } from '../../components/ui/Input';
import { useT } from '../../lib/i18n/core';
import { timezoneOptions } from '../format/timezones';

/**
 * A new profile's time zone (MUT-183 design review Issue 10): the browser's zone as a fact row until the person asks
 * to change it, then the full list. Shared by New profile and, since MUT-368, the signup setup page, which both set a
 * zone once, at creation.
 */
export interface TimezoneChoiceProps {
  id: string;
  /** The zone this browser reports: the fact row, and always one of the options. */
  browserZone: string;
  value: string;
  onChange: (zone: string) => void;
  onBlur?: () => void;
  name?: string;
  open: boolean;
  onOpen: () => void;
  invalid?: boolean;
  selectRef?: Ref<HTMLSelectElement>;
}

export function TimezoneChoice({ id, browserZone, value, onChange, onBlur, name, open, onOpen, invalid, selectRef }: TimezoneChoiceProps) {
  const t = useT();
  const zones = useMemo(() => timezoneOptions(browserZone), [browserZone]);
  return (
    <>
      {open ? (
        <>
          <label className="form-label" htmlFor={id}>
            {t('hosted.profiles.timezone')}
          </label>
          <Select id={id} dir="ltr" invalid={invalid} name={name} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} ref={selectRef}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </>
      ) : (
        <>
          <span className="form-label">{t('hosted.profiles.timezone')}</span>
          <p className="hp-fact-row">
            <bdi dir="ltr">{browserZone}</bdi> <span className="hp-muted">{t('hosted.profiles.timezoneFromBrowser')}</span> ·{' '}
            <button type="button" className="hp-link-button" onClick={onOpen}>
              {t('hosted.profiles.timezoneChange')}
            </button>
          </p>
        </>
      )}
      <p className="form-hint">{t('hosted.profiles.timezoneHint')}</p>
    </>
  );
}
