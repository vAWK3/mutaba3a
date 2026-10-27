import { expect, type Page } from '@playwright/test';
import type { Step } from './qa';

/**
 * MUT-425: the profile switcher and the account menu became the You page; MUT-426's You island opens it on Profiles,
 * and the other parts are a tab away. By class, not by name, so a spec reads the same in Arabic. Shared by the
 * stubbed portal specs and the live ones.
 */

export type YouPart = 'profiles' | 'account' | 'app';
const PART_INDEX: Record<YouPart, number> = { profiles: 0, account: 1, app: 2 };

export async function openYou(page: Page, part: YouPart = 'account'): Promise<void> {
  const island = page.locator('.hp-island');
  // Already on You, a second press would leave the page (MUT-426 D7), so only the part tab is pressed
  if ((await island.getAttribute('aria-current')) !== 'page') await island.click();
  const tabs = page.locator('nav.hp-section-tabs--segmented');
  await expect(tabs).toBeVisible();
  await tabs.getByRole('link').nth(PART_INDEX[part]).click();
  await expect(tabs.getByRole('link').nth(PART_INDEX[part])).toHaveAttribute('aria-current', 'page');
}

/** A row on the You page by its title: rows also carry a second line, so the name starts with the title. */
export const youRow = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

/** MUT-464: switch the portal language on You › App, then go back to the page it was on (the island and the tab are two history entries). */
export async function switchLanguage(page: Page, step: Step, label: 'EN' | 'عربي', dir: 'ltr' | 'rtl') {
  await step(`Switch the portal to ${label === 'EN' ? 'English' : 'Arabic'} on You › App, then go back`, async () => {
    await openYou(page, 'app');
    await page.locator('.hp-lang').getByRole('button', { name: label }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await page.goBack();
    await page.goBack();
  });
}

