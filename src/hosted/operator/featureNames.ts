import { useLanguage, type Translator } from '../../lib/i18n/core';

/**
 * MUT-527: a feature flag's words in the operator console. A flag the portal has words for
 * (`hosted.operator.features.<key>.label`, `.sub`, `.confirmOff`) uses them; one it doesn't yet shows a humanised
 * name (`receipt_reading` → "Receipt reading"), never its raw key, and no sub.
 */
export function humanizeFeature(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export interface FeatureText {
  /** Whether the portal has its own words for the flag. */
  named: boolean;
  label: string;
  sub: string | undefined;
  /** The turn-off confirmation, with the address already isolated by the caller. */
  confirmOff: (email: string) => string;
}

export function useFeatureText(): (feature: string) => FeatureText {
  const { t } = useLanguage();
  // The translator's `has`, as plural.ts reads it; a test double may lack it.
  const has = (key: string) => (t as Partial<Translator>).has?.(key) ?? true;
  return (feature) => {
    const base = `hosted.operator.features.${feature}`;
    const named = has(`${base}.label`);
    const label = named ? t(`${base}.label`) : humanizeFeature(feature);
    return {
      named,
      label,
      sub: named ? t(`${base}.sub`) : undefined,
      confirmOff: (email) => (named ? t(`${base}.confirmOff`, { email }) : t('hosted.operator.features.confirmOff', { email, feature: label })),
    };
  };
}
