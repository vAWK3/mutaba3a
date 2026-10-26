import { isYouPath, sectionOf } from './youRoutes';

/**
 * MUT-426 (eng D6): how a page moves, from the two pathnames alone. Going deeper slides forward, coming back slides
 * the other way, the You page grows out of the island, and everything else cross-fades. The router runs it as a view
 * transition type (`viewTransitionOption`); hosted.css draws each type, mirrored in RTL and a fade under reduced
 * motion. Direction comes from depth, not history, so browser Back and a page's own back link agree. Pure.
 */

export type PageMotion = 'forward' | 'back' | 'island' | 'fade' | 'none';

/** The part of router-core's `ViewTransitionOptions` the portal uses (react-router doesn't re-export the type). */
export interface PageTransitionOption {
  types: (change: { fromLocation?: { pathname: string }; toLocation: { pathname: string } }) => string[] | false;
}

const PROFILE_SEGMENT = 'p';
/** The shell's profile-less page (no profile yet), which the profile-less You returns to */
const HOME_PATH = '/';
/** MUT-448: the account-level Reports, one level above each profile's own Reports */
const GLANCE_PATH = '/reports';
const ID_INDEX = 2; // '' / 'p' / ':id' / …
const REST_INDEX = 3;

/** Pages one level in: each has a way back to its destination (MUT-424 D1). Everything else in a profile is 0. */
const NESTED_SECTIONS: ReadonlySet<string> = new Set(['receivables', 'conversions', 'documents']);
/** Sections whose own sub-pages sit at the top level: Spent's Groups tab (MUT-268 1A); a group inside it is one in. */
const TAB_DEPTH: Readonly<Record<string, number>> = { expenses: 1 };

function segmentsOf(pathname: string): string[] {
  return pathname.split('/');
}

function inProfile(pathname: string): boolean {
  return segmentsOf(pathname)[1] === PROFILE_SEGMENT;
}

function profileIdOf(pathname: string): string | undefined {
  return inProfile(pathname) ? segmentsOf(pathname)[ID_INDEX] : undefined;
}

/** How deep a page inside a profile is: 0 for the destinations, Spent's Groups and Reports; 1 one level in. */
export function depthOf(pathname: string): number {
  const rest = segmentsOf(pathname).slice(REST_INDEX).filter(Boolean);
  const [section] = rest;
  if (section === undefined) return 0;
  if (NESTED_SECTIONS.has(section)) return 1;
  return rest.length > 1 + (TAB_DEPTH[section] ?? 0) ? 1 : 0;
}

/** The motion for one navigation; the first matching rule wins (eng review S3). */
export function pageMotionOf(prev: string | undefined, next: string): PageMotion {
  if (prev === undefined || prev === next) return 'none';
  // The You island shows on every shell page, the no-profile one at `/` included
  if (isYouPath(next)) return isYouPath(prev) ? 'none' : 'island';
  // Back to a shell page; sign-out and setup leave the shell, and never move
  if (isYouPath(prev)) return inProfile(next) || next === HOME_PATH ? 'back' : 'none';
  // MUT-448 (eng D5): a Glance row opens that profile's Reports, one level in; its Back returns to the Glance
  if (prev === GLANCE_PATH && sectionOf(next) === 'reports') return 'forward';
  if (next === GLANCE_PATH && sectionOf(prev) === 'reports') return 'back';
  // Sign-in, setup and the home redirect never move
  if (!inProfile(prev) || !inProfile(next)) return 'none';
  if (profileIdOf(prev) !== profileIdOf(next)) return 'fade';
  const step = depthOf(next) - depthOf(prev);
  if (step > 0) return 'forward';
  if (step < 0) return 'back';
  return 'fade';
}

/**
 * The router's `defaultViewTransition`, only where view-transition types work. router-core 1.144 (router.js:766-790)
 * would otherwise start an untyped transition on every navigation, a drawer's `?tx=` included, and cross-fade it.
 */
export function viewTransitionOption(typesSupported: boolean): PageTransitionOption | undefined {
  if (!typesSupported) return undefined;
  return {
    types: ({ fromLocation, toLocation }) => {
      const motion = pageMotionOf(fromLocation?.pathname, toLocation.pathname);
      return motion === 'none' ? false : [motion];
    },
  };
}

/**
 * Whether the browser takes view-transition types. Both spellings must pass: ours, and router-core's own check
 * (router.js:146, which drops the closing parenthesis), since the router ignores the types when its check says no.
 */
export function supportsViewTransitionTypes(supports: ((query: string) => boolean) | undefined): boolean {
  if (!supports) return false;
  return supports('selector(:active-view-transition-type(a))') && supports('selector(:active-view-transition-type(a)');
}
