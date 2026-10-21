import { SUPPORT_EMAIL } from '../terms';

/** The add-a-partner email (DR14): the profile named in the subject, and what the operator needs in the body. */
export function mailtoFor(profileName: string, t: (key: string, vars?: Record<string, string>) => string): string {
  const subject = encodeURIComponent(t('hosted.profiles.owners.mailSubject', { profile: profileName }));
  const body = encodeURIComponent(t('hosted.profiles.owners.mailBody', { profile: profileName }));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
