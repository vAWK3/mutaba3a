import { expect, type Page } from '@playwright/test';

/**
 * MUT-425: the profile switcher and the account menu became the You page. The sidebar's two links open it: the open
 * profile's name on Profiles, the avatar on Account. By class, not by name, so a spec reads the same in Arabic.
 * Shared by the stubbed portal specs and the live ones.
 */

export type YouPart = 'profiles' | 'account' | 'app';
const PART_INDEX: Record<YouPart, number> = { profiles: 0, account: 1, app: 2 };

export async function openYou(page: Page, part: YouPart = 'account'): Promise<void> {
  await page.locator(part === 'profiles' ? '.hp-you-link-profile' : '.hp-you-link-account').click();
  const tabs = page.locator('nav.hp-section-tabs--segmented');
  await expect(tabs).toBeVisible();
  if (part === 'app') await tabs.getByRole('link').nth(PART_INDEX.app).click();
  await expect(tabs.getByRole('link').nth(PART_INDEX[part])).toHaveAttribute('aria-current', 'page');
}

/** A row on the You page by its title: rows also carry a second line, so the name starts with the title. */
export const youRow = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
