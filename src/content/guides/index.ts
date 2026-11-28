import { GUIDE_ID_SHAPE, parseGuide, type Guide } from './guideSchema';

export type { Guide, GuideStep, GuideSurface, LocalizedText } from './guideSchema';

/**
 * MUT-674 (D2): every guide in this folder, loaded when it is opened. `import.meta.glob` without `eager` makes each
 * file its own ~1 KB chunk, so the portal ships none of them until a person opens one, and adding a guide is adding
 * a file: no registry to edit. The website's help pages (MUT-678) read the same files with their own eager glob.
 */
const loaders = import.meta.glob('./*.json', { import: 'default' }) as Record<string, () => Promise<unknown>>;

const idOfPath = (path: string) => path.replace(/^\.\/(.+)\.json$/, '$1');
const byId = new Map(Object.entries(loaders).map(([path, load]) => [idOfPath(path), load] as const));

/** Every guide's id, sorted. */
export const GUIDE_IDS: readonly string[] = [...byId.keys()].sort();

/** True for an id that names a file here. Anything else (a typo, an old link, `../x`) is not a guide. */
export function isGuideId(id: string): boolean {
  return GUIDE_ID_SHAPE.test(id) && byId.has(id);
}

/** A guide file that is there but does not pass the format: a build error in practice, since CI parses every file. */
export class GuideContentError extends Error {}

/** Fetches and checks one guide. Rejects when the chunk cannot be fetched (offline, stale after a deploy) or the file is invalid. */
export async function loadGuide(id: string): Promise<Guide> {
  const load = byId.get(id);
  if (!load) throw new GuideContentError(`no guide "${id}"`);
  const result = parseGuide(await load(), id);
  if (!result.ok) throw new GuideContentError(`guide "${id}": ${result.problems.join('; ')}`);
  return result.guide;
}
