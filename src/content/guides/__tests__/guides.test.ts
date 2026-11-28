import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_ART } from '../../../components/illustrations/generated';
import { GUIDE_IDS, isGuideId } from '../index';
import { parseGuide, type Guide } from '../guideSchema';

/**
 * MUT-674 (D2, D4, D8): the real guide files, checked in CI so a wrong file never reaches the viewer. Adding a guide is
 * adding `src/content/guides/<id>.json`; this test is what tells the author what else the format needs.
 */

const files = import.meta.glob('../*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fileIdOf = (path: string) => path.replace(/^\.\.\/(.+)\.json$/, '$1');
const entries = Object.entries(files).map(([path, raw]) => ({ id: fileIdOf(path), raw }));

/** A scene with no `-rtl` twin is direction-neutral (an object, not a reading direction): it is declared here, with its guide. */
const NEUTRAL_SCENES: readonly string[] = ['guide-invoice-2'];
const hasRtlTwin = (scene: string) => Object.hasOwn(SCENE_ART, `${scene}-rtl`) || NEUTRAL_SCENES.includes(scene);

const contract = JSON.parse(readFileSync(resolve(__dirname, '../../../../docs/analytics/events.json'), 'utf8')) as {
  events: Record<string, { emitters: string[]; properties?: { guide?: { type: string; values: string[] } } }>;
};

function guidesOf(): Guide[] {
  return entries.map(({ id, raw }) => {
    const result = parseGuide(raw, id);
    if (!result.ok) throw new Error(`${id}.json: ${result.problems.join('; ')}`);
    return result.guide;
  });
}

describe('the guide files', () => {
  it('the registry lists exactly the files', () => {
    expect([...GUIDE_IDS].sort()).toEqual(entries.map((e) => e.id).sort());
    for (const id of GUIDE_IDS) expect(isGuideId(id)).toBe(true);
    expect(isGuideId('no-such-guide')).toBe(false);
    expect(isGuideId('../secret')).toBe(false);
  });

  it.each(entries.map((e) => [e.id, e.raw] as const))('%s.json parses', (id, raw) => {
    const result = parseGuide(raw, id);
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it('every hero and step scene is drawn, and has its -rtl drawing unless it is direction-neutral', () => {
    const problems: string[] = [];
    for (const guide of guidesOf()) {
      for (const scene of [guide.hero, ...guide.steps.map((s) => s.scene)]) {
        if (!Object.hasOwn(SCENE_ART, scene)) problems.push(`${guide.id}: scene "${scene}" is not drawn`);
        else if (scene.startsWith('guide-') && !hasRtlTwin(scene)) problems.push(`${guide.id}: scene "${scene}" has no -rtl drawing`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('states no rate, amount or currency: a guide says what MTB3A does and links the authority\'s own page (MUT-673)', () => {
    const lines = guidesOf().flatMap((g) => JSON.stringify(g).match(/"(?:ar|en|he)":"([^"]*)"/g) ?? []);
    const offending = lines.filter((line) => /[%₪$€]|\bNIS\b|\bILS\b/i.test(line));
    expect(offending).toEqual([]);
  });

  it('every portal guide is in the analytics contract, and the contract names no guide without a file', () => {
    const opened = contract.events.guide_opened?.properties?.guide;
    const finished = contract.events.guide_finished?.properties?.guide;
    expect(opened?.type).toBe('enum');
    expect(finished?.values).toEqual(opened?.values);
    // The contract's enum values are snake_case: a guide's id with dashes as underscores (`trackGuide`).
    const inContract = [...(opened?.values ?? [])].sort();
    const portalGuides = guidesOf()
      .filter((g) => g.surfaces.includes('portal'))
      .map((g) => g.id.replaceAll('-', '_'))
      .sort();
    const missing = portalGuides.filter((id) => !inContract.includes(id));
    const stale = inContract.filter((id) => !portalGuides.includes(id));
    expect(
      { missing, stale },
      `Add "${missing[0] ?? ''}" to the guide enum of guide_opened and guide_finished in docs/analytics/events.json (bump its version and pin the hash, docs/analytics/README.md "Changing the contract")`,
    ).toEqual({ missing: [], stale: [] });
  });

  it('both events are portal events with only the guide property', () => {
    for (const name of ['guide_opened', 'guide_finished']) {
      const event = contract.events[name];
      expect(event?.emitters, name).toEqual(['portal']);
      expect(Object.keys(event?.properties ?? {}), name).toEqual(['guide']);
    }
  });
});
