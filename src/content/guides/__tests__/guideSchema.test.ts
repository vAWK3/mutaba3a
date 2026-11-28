import { describe, expect, it } from 'vitest';
import { parseGuide } from '../guideSchema';
import { FIXTURE_GUIDE } from './fixtures/fixtureGuide';

/**
 * MUT-674 (D3): the parser is the only door a guide file passes through. It returns the problems instead of throwing,
 * so the viewer can show an unreachable state instead of a blank drawer.
 */

const clone = () => structuredClone(FIXTURE_GUIDE) as Record<string, unknown>;

function problemsOf(raw: unknown, fileId = 'fixture-guide'): string[] {
  const result = parseGuide(raw, fileId);
  return result.ok ? [] : result.problems;
}

describe('parseGuide', () => {
  it('parses a full guide', () => {
    const result = parseGuide(FIXTURE_GUIDE, 'fixture-guide');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.guide.id).toBe('fixture-guide');
      expect(result.guide.steps).toHaveLength(2);
      expect(result.guide.title.ar).not.toBe('');
    }
  });

  it('accepts a guide with no note and no source, and an optional Hebrew line', () => {
    const raw = clone();
    delete raw.note;
    delete raw.source;
    (raw.title as Record<string, string>).he = 'כותרת';
    expect(problemsOf(raw)).toEqual([]);
  });

  it('rejects anything that is not an object', () => {
    for (const raw of [null, undefined, 'guide', 7, [], true]) expect(problemsOf(raw)).not.toEqual([]);
  });

  it('rejects an id that is not the file name, or is not a slug', () => {
    expect(problemsOf(FIXTURE_GUIDE, 'other-name')).toEqual([expect.stringContaining('id')]);
    expect(problemsOf({ ...clone(), id: 'Bad Id' }, 'Bad Id')).not.toEqual([]);
    expect(problemsOf({ ...clone(), id: 'x'.repeat(41) }, 'x'.repeat(41))).not.toEqual([]);
  });

  it('rejects a title, lead, step or note missing its Arabic or English line', () => {
    for (const lang of ['ar', 'en'] as const) {
      const noTitle = clone();
      delete (noTitle.title as Record<string, string>)[lang];
      expect(problemsOf(noTitle)).toEqual([expect.stringContaining('title')]);

      const noLead = clone();
      delete (noLead.lead as Record<string, string>)[lang];
      expect(problemsOf(noLead)).toEqual([expect.stringContaining('lead')]);

      const noStep = clone();
      delete ((noStep.steps as { text: Record<string, string> }[])[1]!.text)[lang];
      expect(problemsOf(noStep)).toEqual([expect.stringContaining('steps[1]')]);

      const noNote = clone();
      delete (noNote.note as Record<string, string>)[lang];
      expect(problemsOf(noNote)).toEqual([expect.stringContaining('note')]);
    }
  });

  it('rejects an empty or blank line', () => {
    const empty = clone();
    (empty.title as Record<string, string>).en = '';
    expect(problemsOf(empty)).not.toEqual([]);
    const blank = clone();
    (blank.lead as Record<string, string>).ar = '   ';
    expect(problemsOf(blank)).not.toEqual([]);
  });

  it('rejects a guide with no steps', () => {
    expect(problemsOf({ ...clone(), steps: [] })).toEqual([expect.stringContaining('steps')]);
  });

  it('rejects a key the format does not know, at every level', () => {
    expect(problemsOf({ ...clone(), colour: 'red' })).toEqual([expect.stringContaining('colour')]);
    const step = clone();
    (step.steps as Record<string, unknown>[])[0]!.extra = 1;
    expect(problemsOf(step)).toEqual([expect.stringContaining('extra')]);
    const text = clone();
    (text.title as Record<string, string>).fr = 'Titre';
    expect(problemsOf(text)).toEqual([expect.stringContaining('fr')]);
  });

  it('rejects a source that is not an https link', () => {
    for (const url of ['javascript:alert(1)', 'http://example.com', 'mailto:a@b.c', 'not a url', '']) {
      const raw = clone();
      (raw.source as Record<string, unknown>).url = url;
      expect(problemsOf(raw), url).toEqual([expect.stringContaining('source')]);
    }
  });

  it('accepts a guide with no ifStuck, and rejects one missing its Arabic or English line', () => {
    const none = clone();
    delete none.ifStuck;
    expect(problemsOf(none)).toEqual([]);
    for (const lang of ['ar', 'en'] as const) {
      const raw = clone();
      delete (raw.ifStuck as Record<string, string>)[lang];
      expect(problemsOf(raw)).toEqual([expect.stringContaining('ifStuck')]);
    }
    const blank = clone();
    (blank.ifStuck as Record<string, string>).en = '  ';
    expect(problemsOf(blank)).toEqual([expect.stringContaining('ifStuck')]);
  });

  it('rejects an unknown surface and an empty surface list', () => {
    expect(problemsOf({ ...clone(), surfaces: ['portal', 'watch'] })).not.toEqual([]);
    expect(problemsOf({ ...clone(), surfaces: [] })).not.toEqual([]);
  });

  it('rejects a hero or step scene that is not a name', () => {
    expect(problemsOf({ ...clone(), hero: '' })).not.toEqual([]);
    const step = clone();
    (step.steps as Record<string, unknown>[])[0]!.scene = 3;
    expect(problemsOf(step)).not.toEqual([]);
  });

  it('reports every problem, not only the first', () => {
    const raw = clone();
    delete (raw.title as Record<string, string>).ar;
    raw.steps = [];
    expect(problemsOf(raw).length).toBeGreaterThanOrEqual(2);
  });
});
