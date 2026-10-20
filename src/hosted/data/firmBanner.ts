/**
 * MUT-300 (DR5): where the "Firm features are on" note remembers being
 * dismissed: this browser, per person and profile (the UsagePrompt
 * precedent). Never sent anywhere. Storage that throws counts as not
 * dismissed, and a dismissal it refuses lasts for the page only.
 */

const DISMISSED = 'dismissed';

export function firmBannerKey(userId: string, profileId: string): string {
  return `mutaba3a-firm-banner:${userId}:${profileId}`;
}

export function wasFirmBannerDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === DISMISSED;
  } catch {
    return false;
  }
}

export function rememberFirmBannerDismissed(key: string): void {
  try {
    localStorage.setItem(key, DISMISSED);
  } catch {
    // Private windows can refuse storage; the component's state still hides the note for this page
  }
}
