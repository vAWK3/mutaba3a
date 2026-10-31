import { describe, expect, it } from 'vitest';
import { humanizeFeature } from '../featureNames';

/** MUT-527: a flag the portal has no words for shows a humanised name, never its key. */
describe('humanizeFeature', () => {
  it('turns a snake_case key into a sentence-case name', () => {
    expect(humanizeFeature('receipt_reading')).toBe('Receipt reading');
    expect(humanizeFeature('agent_access')).toBe('Agent access');
    expect(humanizeFeature('bank-feeds')).toBe('Bank feeds');
  });

  it('collapses repeated separators and lower-cases the rest', () => {
    expect(humanizeFeature('__INVOICE__inbox_')).toBe('Invoice inbox');
  });

  it('keeps a key with nothing to humanise as it is', () => {
    expect(humanizeFeature('___')).toBe('___');
    expect(humanizeFeature('ocr')).toBe('Ocr');
  });
});
