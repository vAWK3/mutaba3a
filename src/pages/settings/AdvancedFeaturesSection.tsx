import { useT } from '../../lib/i18n';
import { Switch } from '../../components/ui/Switch';
import { FEATURE_KEYS } from '../../lib/features/features';
import { useFeatureFlags, useSetFeatureEnabled } from '../../lib/features/useFeatures';

/** A grid of four squares: "this changes which sections exist," not a gear
 *  (gear already means Settings) and not a warning triangle (this isn't
 *  destructive, just structural — MUT-139). */
function GridIcon() {
  return (
    <svg className="settings-section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/**
 * Settings › Advanced features (MUT-12): one switch per optional area, all off
 * on a fresh install. Reads through `useFeatureFlags`, writes through
 * `useSetFeatureEnabled`; never touches the settings row directly.
 */
export function AdvancedFeaturesSection() {
  const t = useT();
  const features = useFeatureFlags();
  const setFeature = useSetFeatureEnabled();

  return (
    <div className="settings-section" data-testid="settings-features">
      <div className="settings-section-header">
        <div className="settings-section-title-group">
          <GridIcon />
          <div>
            <h2 className="settings-section-title">{t('settings.features.title')}</h2>
            <p className="settings-section-description">{t('settings.features.description')}</p>
          </div>
        </div>
      </div>
      {FEATURE_KEYS.map((key) => (
        <div className="settings-row" key={key}>
          <div>
            <div className="settings-label" id={`feature-${key}-label`}>
              {t(`settings.features.items.${key}.label`)}
            </div>
            <div className="settings-description">{t(`settings.features.items.${key}.description`)}</div>
          </div>
          <Switch
            checked={features[key]}
            onChange={(enabled) => setFeature.mutate({ key, enabled })}
            labelledBy={`feature-${key}-label`}
            disabled={setFeature.isPending}
          />
        </div>
      ))}
    </div>
  );
}
