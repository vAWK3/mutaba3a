import { describe, it, expect } from 'vitest';
import en from '../../i18n/translations/en.json';
import ar from '../../i18n/translations/ar.json';
import { FEATURE_KEYS } from '../features';

type Dict = Record<string, unknown>;

function featuresBlock(locale: Dict): Dict {
  return (locale.settings as Dict).features as Dict;
}

describe('settings.features i18n keys', () => {
  it.each([
    ['en', en as Dict],
    ['ar', ar as Dict],
  ])('%s has a label and description for every feature key and the section copy', (_name, locale) => {
    const block = featuresBlock(locale);
    expect(typeof block.title).toBe('string');
    expect(typeof block.description).toBe('string');
    expect(String(block.autoEnabled)).toContain('{features}');
    expect(typeof block.openSettings).toBe('string');
    expect(typeof block.dismiss).toBe('string');
    const items = block.items as Dict;
    expect(Object.keys(items).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const key of FEATURE_KEYS) {
      const item = items[key] as Dict;
      expect(typeof item.label, `${key}.label`).toBe('string');
      expect(String(item.label).length).toBeGreaterThan(0);
      expect(typeof item.description, `${key}.description`).toBe('string');
    }
  });
});
