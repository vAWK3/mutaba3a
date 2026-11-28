/**
 * MUT-674: one guide, as `src/content/guides/<id>.json` holds it. The same file serves the portal's drawer, the
 * website's help pages (MUT-678) and the phone (MUT-677), so it is plain JSON: no code, no i18n keys, copy inline.
 */

/** Where a guide is shown: the portal's drawer, the phone app, the public website's help pages. */
export type GuideSurface = 'portal' | 'phone' | 'web';

/** A line in each language. Arabic and English are required; Hebrew is for the website's pages only (MUT-689). */
export interface LocalizedText {
  ar: string;
  en: string;
  he?: string;
}

export interface GuideStep {
  text: LocalizedText;
  /** A scene name from `assets/illustrations/source/` (the plain name; the `-rtl` drawing is picked by direction). */
  scene: string;
}

export interface GuideSource {
  /** https only: a guide never links to a page that can run script or downgrade the connection. */
  url: string;
  label: LocalizedText;
}

export interface Guide {
  /** The file's name without `.json`: the `?guide=` value and the analytics value. */
  id: string;
  surfaces: GuideSurface[];
  title: LocalizedText;
  lead: LocalizedText;
  hero: string;
  steps: GuideStep[];
  note?: LocalizedText;
  /** What to do when it goes wrong: one or two lines, shown after the note. */
  ifStuck?: LocalizedText;
  source?: GuideSource;
}
