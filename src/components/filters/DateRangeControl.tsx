import { useState, useEffect } from 'react';
import { getDateRangePreset } from '../../lib/utils';
import { useT } from '../../lib/i18n';

type DatePreset = 'this-month' | 'last-month' | 'this-year' | 'all';

interface DateRangeControlProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
}

export function DateRangeControl({ dateFrom, dateTo, onChange }: DateRangeControlProps) {
  const t = useT();
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customFrom, setCustomFrom] = useState(dateFrom);
  const [customTo, setCustomTo] = useState(dateTo);

  const presets: { value: DatePreset; labelKey: string }[] = [
    { value: 'this-month', labelKey: 'filters.thisMonth' },
    { value: 'last-month', labelKey: 'filters.lastMonth' },
    { value: 'this-year', labelKey: 'filters.thisYear' },
    { value: 'all', labelKey: 'filters.allTime' },
  ];

  const getCurrentPreset = (): DatePreset | 'custom' => {
    for (const preset of presets) {
      const range = getDateRangePreset(preset.value);
      if (range.dateFrom === dateFrom && range.dateTo === dateTo) {
        return preset.value;
      }
    }
    return 'custom';
  };

  const currentPreset = getCurrentPreset();

  // Sync custom dates when external dateFrom/dateTo change
  // Using a micro-task to avoid synchronous setState in effect
  useEffect(() => {
    if (currentPreset === 'custom') {
      Promise.resolve().then(() => {
        setCustomFrom(dateFrom);
        setCustomTo(dateTo);
      });
    }
  }, [dateFrom, dateTo, currentPreset]);

  const handlePresetChange = (preset: string) => {
    if (preset === 'custom') {
      setShowCustomPicker(true);
      // Initialize custom dates with current range
      setCustomFrom(dateFrom);
      setCustomTo(dateTo);
      return;
    }
    setShowCustomPicker(false);
    const range = getDateRangePreset(preset as DatePreset);
    onChange(range.dateFrom, range.dateTo);
  };

  const handleCustomDateChange = (type: 'from' | 'to', value: string) => {
    if (type === 'from') {
      setCustomFrom(value);
      if (value && customTo) {
        onChange(value, customTo);
      }
    } else {
      setCustomTo(value);
      if (customFrom && value) {
        onChange(customFrom, value);
      }
    }
  };

  // Show custom picker if current preset is custom (e.g., from URL params)
  const isCustomActive = currentPreset === 'custom' || showCustomPicker;

  return (
    <div className="date-range-control" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <select
        className="select"
        value={isCustomActive ? 'custom' : currentPreset}
        onChange={(e) => handlePresetChange(e.target.value)}
      >
        {presets.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {t(preset.labelKey)}
          </option>
        ))}
        <option value="custom">{t('filters.custom')}</option>
      </select>

      {isCustomActive && (
        <div className="custom-date-inputs" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            type="date"
            className="input"
            value={customFrom}
            onChange={(e) => handleCustomDateChange('from', e.target.value)}
            style={{ width: 'auto', padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--font-size-sm)' }}
          />
          <span style={{ color: 'var(--color-text-muted)' }}>–</span>
          <input
            type="date"
            className="input"
            value={customTo}
            onChange={(e) => handleCustomDateChange('to', e.target.value)}
            style={{ width: 'auto', padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--font-size-sm)' }}
          />
        </div>
      )}
    </div>
  );
}
