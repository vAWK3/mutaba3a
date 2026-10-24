import type { Me } from '../api/client';

/**
 * Where a person lands after the first sign-in from a signup link (MUT-368, D13): their personal profile's Home.
 * The seam for MUT-418, whose "Your 14-day trial has started" step goes here, read from `me`. Anywhere a profile is
 * missing, `/` decides (HomeRedirect: the first profile, or the offer to create one).
 */
export function firstRunPath(me: Me): string {
  const personal = me.profiles.find((profile) => profile.isPersonalDefault);
  return personal ? `/p/${personal.id}` : '/';
}
