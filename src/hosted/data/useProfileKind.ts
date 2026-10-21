import { useLanguage } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { profileKindKey, sharedWith } from './profileRules';

/**
 * The line under a profile's name, in the switcher and the Manage list alike. MUT-373 (DR12): a shared profile adds
 * who you share it with — never you — as one list in the viewer's language ("Business · Shared with Sara and Omar").
 */
export function useProfileKind(profile: HostedProfile, viewerId: string): string {
  const { t, language } = useLanguage();
  const kind = t(profileKindKey(profile));
  const others = sharedWith(profile, viewerId);
  if (!others) return kind;
  return `${kind} · ${t('hosted.profiles.shared', { names: listOfNames(others, language) })}`;
}

/** "Sara", "Sara and Omar" / "سارة وعمر": one list in the reader's language. */
export function listOfNames(names: readonly string[], language: string): string {
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(names);
}
