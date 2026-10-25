/**
 * The portal's four destinations (MUT-424, ADR-192): Owed, Paid, Spent, Clients. Every URL stays as it was (E1: the
 * phone's universal links, the mail and Stripe landings and bookmarks all point at them), so a destination is a map
 * from a path's first segment under `/p/:id`, not a URL prefix: `/receivables` lights Owed without being nested
 * under it. Pure, so every rule is a unit test; MUT-426's floating pill uses it.
 */

export const DESTINATIONS = [
  { key: 'owed', path: '' },
  { key: 'paid', path: '/payments' },
  { key: 'spent', path: '/expenses' },
  { key: 'clients', path: '/clients' },
] as const;

export type Destination = (typeof DESTINATIONS)[number]['key'];

/** The first segment after `/p/:id` (the overview is the bare path) → the destination it sits in or under. */
const DESTINATION_OF_SEGMENT: Record<string, Destination> = {
  '': 'owed',
  receivables: 'owed',
  payments: 'paid',
  conversions: 'paid',
  expenses: 'spent',
  clients: 'clients',
  documents: 'clients',
};

/**
 * Pages that deliberately light no destination: Reports opens from its own icon (eng review R2, MUT-426), and the You
 * page from the You island (MUT-425). A route that is neither here nor mapped above fails the route-walking test.
 */
export const NO_DESTINATION: ReadonlySet<string> = new Set(['reports', 'you']);

const PROFILE_SEGMENT = 'p';

/** The destination a portal path belongs to, or null outside a profile, on an exception, or on an unknown page. */
export function destinationOf(pathname: string): Destination | null {
  const [, first, , section = ''] = pathname.split(/[?#]/)[0].split('/');
  if (first !== PROFILE_SEGMENT) return null;
  return Object.hasOwn(DESTINATION_OF_SEGMENT, section) ? DESTINATION_OF_SEGMENT[section] : null;
}

export function destinationPath(profileId: string, destination: Destination): string {
  const entry = DESTINATIONS.find((d) => d.key === destination);
  return `/p/${profileId}${entry?.path ?? ''}`;
}
