/**
 * The You page's paths (MUT-425): `/p/:id/you`, `/you/account`, `/you/app`, and the same three without a profile
 * (`/you`, for a person with no profile or on one they lost). Pure, so every rule is a unit test.
 *
 * A profile switch from the page keeps the section the person came from (eng review D3): the links into the page
 * carry it as `?from=<section>`, the part tabs and the drawers keep it, and only a known section survives the parse.
 */

export const YOU_PARTS = ['profiles', 'account', 'app'] as const;
export type YouPart = (typeof YOU_PARTS)[number];

/** The profile's sections, by their first path segment after `/p/:id` (the overview is the bare path). */
export const SECTION_SEGMENTS = ['clients', 'receivables', 'payments', 'documents', 'expenses', 'conversions'] as const;
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
}

export function parseYouSearch(raw: Record<string, unknown>): YouSearch {
  return isSection(raw.from) ? { from: raw.from } : {};
}

/** Where picking a profile goes: the kept section in that profile, or its home (D4: the open profile too). */
export function switchTarget(profileId: string, from: SectionSegment | undefined): string {
  return from ? `/p/${profileId}/${from}` : `/p/${profileId}`;
}
