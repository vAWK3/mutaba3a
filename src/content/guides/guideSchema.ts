import type { Guide, GuideSurface } from './types';

export type { Guide, GuideSource, GuideStep, GuideSurface, LocalizedText } from './types';

/**
 * MUT-674 (D3): the one door a guide file passes through. Hand-rolled like `releaseNotes.ts` (the portal chunk takes no
 * schema library for ~40 lines of checks). It never throws: it returns every problem, so a bad file shows up in CI
 * (`guides.test.ts`) with its line named, and the viewer shows its unreachable state instead of a blank drawer.
 */

export type ParseResult = { ok: true; guide: Guide } | { ok: false; problems: string[] };

/** A guide id is a lower-case slug; the same shape `?guide=` accepts (`parseProfileDrawer`). */
export const GUIDE_ID_SHAPE = /^[a-z0-9-]{1,40}$/;

const SURFACES: readonly GuideSurface[] = ['portal', 'phone', 'web'];
const GUIDE_KEYS = ['id', 'surfaces', 'title', 'lead', 'hero', 'steps', 'note', 'ifStuck', 'source'];
const STEP_KEYS = ['text', 'scene'];
const SOURCE_KEYS = ['url', 'label'];
const TEXT_KEYS = ['ar', 'en', 'he'];

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLine = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function unknownKeys(at: string, raw: Raw, allowed: readonly string[]): string[] {
  return Object.keys(raw)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${at}: "${key}" is not part of the format`);
}

function textProblems(at: string, raw: unknown): string[] {
  if (!isObject(raw)) return [`${at}: needs { ar, en }`];
  const problems = unknownKeys(at, raw, TEXT_KEYS);
  for (const lang of ['ar', 'en']) if (!isLine(raw[lang])) problems.push(`${at}: needs a non-empty ${lang} line`);
  if (raw.he !== undefined && !isLine(raw.he)) problems.push(`${at}: the he line is empty`);
  return problems;
}

function sceneProblems(at: string, raw: unknown): string[] {
  return isLine(raw) ? [] : [`${at}: needs a scene name`];
}

function stepProblems(at: string, raw: unknown): string[] {
  if (!isObject(raw)) return [`${at}: needs { text, scene }`];
  return [...unknownKeys(at, raw, STEP_KEYS), ...textProblems(`${at}.text`, raw.text), ...sceneProblems(`${at}.scene`, raw.scene)];
}

function isHttps(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function sourceProblems(raw: unknown): string[] {
  if (!isObject(raw)) return ['source: needs { url, label }'];
  const problems = [...unknownKeys('source', raw, SOURCE_KEYS), ...textProblems('source.label', raw.label)];
  if (!isHttps(raw.url)) problems.push('source: url must be an https link');
  return problems;
}

function surfaceProblems(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return ['surfaces: needs at least one of portal, phone, web'];
  return raw.filter((s) => !SURFACES.includes(s as GuideSurface)).map((s) => `surfaces: "${String(s)}" is not portal, phone or web`);
}

function problemsOf(raw: unknown, fileId: string): string[] {
  if (!isObject(raw)) return ['a guide is a JSON object'];
  const problems = unknownKeys('guide', raw, GUIDE_KEYS);
  if (!GUIDE_ID_SHAPE.test(fileId)) problems.push(`id: the file name "${fileId}" is not a lower-case slug (a-z, 0-9, -, up to 40)`);
  if (raw.id !== fileId) problems.push(`id: "${String(raw.id)}" must equal the file name "${fileId}"`);
  problems.push(...surfaceProblems(raw.surfaces), ...textProblems('title', raw.title), ...textProblems('lead', raw.lead), ...sceneProblems('hero', raw.hero));
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) problems.push('steps: needs at least one step');
  else raw.steps.forEach((step, i) => problems.push(...stepProblems(`steps[${i}]`, step)));
  if (raw.note !== undefined) problems.push(...textProblems('note', raw.note));
  if (raw.ifStuck !== undefined) problems.push(...textProblems('ifStuck', raw.ifStuck));
  if (raw.source !== undefined) problems.push(...sourceProblems(raw.source));
  return problems;
}

/** Checks `raw` against the format; `fileId` is the file's name without `.json`, which the id must equal. */
export function parseGuide(raw: unknown, fileId: string): ParseResult {
  const problems = problemsOf(raw, fileId);
  return problems.length === 0 ? { ok: true, guide: raw as Guide } : { ok: false, problems };
}
