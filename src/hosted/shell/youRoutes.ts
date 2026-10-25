/**
 * The You page's paths (MUT-425): `/p/:id/you`, `/you/account`, `/you/app`, and the same three without a profile
 * (`/you`, for a person with no profile or on one they lost). Pure, so every rule is a unit test.
 *
 * A profile switch from the page keeps the section the person came from (eng review D3): the links into the page
 * carry it as `?from=<section>`, the part tabs and the drawers keep it, and only a known section survives the parse.
 * The You island also carries `?back=<path>`, the exact page it was opened from, so its second press returns there
 * (MUT-426 D7). Only the island reads it: a profile switch keeps the section, never the record.
 */

export const YOU_PARTS = ['profiles', 'account', 'app'] as const;
export type YouPart = (typeof YOU_PARTS)[number];

/**
 * The profile's sections, by their first path segment after `/p/:id` (the overview is the bare path). Reports is one
 * too: every profile has its own, so a switch from it lands on the other profile's (MUT-426 D8).
 */
export const SECTION_SEGMENTS = ['clients', 'receivables', 'payments', 'documents', 'expenses', 'conversions', 'reports'] as const;
export type SectionSegment = (typeof SECTION_SEGMENTS)[number];

const SECTION_SEGMENT_INDEX = 3; // '' / 'p' / ':id' / section
const YOU_SEGMENT = 'you';
const PART_SUFFIX: Record<YouPart, string> = { profiles: '', account: '/account', app: '/app' };

function isSection(value: unknown): value is SectionSegment {
  return typeof value === 'string' && (SECTION_SEGMENTS as readonly string[]).includes(value);
}

/** The section a path is in, or undefined for the overview, the You page and anything unknown. */
export function sectionOf(pathname: string): SectionSegment | undefined {
  const segment = pathname.split('/')[SECTION_SEGMENT_INDEX];
  return isSection(segment) ? segment : undefined;
}

export function isYouPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return segments[0] === YOU_SEGMENT || (segments[0] === 'p' && segments[2] === YOU_SEGMENT);
}

export function youPath(profileId: string | null, part: YouPart): string {
  const base = profileId ? `/p/${profileId}/${YOU_SEGMENT}` : `/${YOU_SEGMENT}`;
  return `${base}${PART_SUFFIX[part]}`;
}

export interface YouSearch {
  from?: SectionSegment;
  back?: string;
}

/**
 * A page inside a profile, path only: `/p/<id>` then a known section and its own segments. No query, hash, dot
 * segment, backslash or second slash can pass, so `back` never leaves the portal or reaches the You page (D7).
 */
const BACK_PATH = /^\/p\/([\w-]+)(?:\/([a-z]+)(?:\/[\w-]+)*)?$/;

function backOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = BACK_PATH.exec(value);
  if (!match) return undefined;
  const section = match[2];
  return section === undefined || isSection(section) ? value : undefined;
}

export function parseYouSearch(raw: Record<string, unknown>): YouSearch {
  const back = backOf(raw.back);
  return { ...(isSection(raw.from) ? { from: raw.from } : {}), ...(back ? { back } : {}) };
}

/** Where picking a profile goes: the kept section in that profile, or its home (D4: the open profile too). */
export function switchTarget(profileId: string, from: SectionSegment | undefined): string {
  return from ? `/p/${profileId}/${from}` : `/p/${profileId}`;
}

/** Where the island's second press leaves the You page for: the exact page in this profile, else the kept section. */
export function islandTarget(profileId: string | null, search: YouSearch): string {
  if (!profileId) return '/';
  if (search.back?.split('/')[2] === profileId) return search.back;
  return switchTarget(profileId, search.from);
}
