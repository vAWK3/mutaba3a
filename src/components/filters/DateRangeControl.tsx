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

  const handlePresetChange = (preset: string) => {
    if (preset === 'custom') return;
    const range = getDateRangePreset(preset as DatePreset);
    onChange(range.dateFrom, range.dateTo);
  };

  return (
    <select
      className="select"
      value={getCurrentPreset()}
      onChange={(e) => handlePresetChange(e.target.value)}
    >
      {presets.map((preset) => (
        <option key={preset.value} value={preset.value}>
          {t(preset.labelKey)}
        </option>
      ))}
      {getCurrentPreset() === 'custom' && (
        <option value="custom">{t('filters.custom')}</option>
      )}
    </select>
  );
}
