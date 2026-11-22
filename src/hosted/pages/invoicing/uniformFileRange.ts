/** MUT-569: the uniform-file card's date presets. Last year is the whole previous tax year; this year runs to today. */
export type Preset = 'lastYear' | 'thisYear' | 'custom';

export function rangeOf(preset: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  // Not an amount: the year of a YYYY-MM-DD date.
  // eslint-disable-next-line no-restricted-syntax
  const year = Number.parseInt(today.slice(0, 4), 10);
  return preset === 'lastYear' ? { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` } : { from: `${year}-01-01`, to: today };
}
