import { useT } from '../../lib/i18n';
import { Switch } from '../../components/ui/Switch';
import { FEATURE_KEYS } from '../../lib/features/features';
import { useFeatureFlags, useSetFeatureEnabled } from '../../lib/features/useFeatures';

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
      <h3 className="settings-section-title">{t('settings.features.title')}</h3>
      <p className="settings-description" style={{ marginBottom: 12 }}>
        {t('settings.features.description')}
      </p>
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
