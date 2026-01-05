import { getDateRangePreset } from '../../lib/utils';

type DatePreset = 'this-month' | 'last-month' | 'this-year' | 'all';

interface DateRangeControlProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
}

export function DateRangeControl({ dateFrom, dateTo, onChange }: DateRangeControlProps) {
  const presets: { value: DatePreset; label: string }[] = [
    { value: 'this-month', label: 'This Month' },
    { value: 'last-month', label: 'Last Month' },
    { value: 'this-year', label: 'This Year' },
    { value: 'all', label: 'All Time' },
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
          {preset.label}
        </option>
      ))}
      {getCurrentPreset() === 'custom' && (
        <option value="custom">Custom</option>
      )}
    </select>
  );
}
