import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, switchToArabic } from '../../support/app';

/**
 * What's new (MUT-24). The build must run as a version release-notes.json
 * describes: before the release bump that is the next version, so QA builds
 * set MUTABA3A_APP_VERSION to it. The spec reads the same file the app bundles,
 * so a notes edit never needs a spec change.
 */
type Notes = Record<string, { en: string[]; ar: string[] }>;
const notesFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../release-notes.json');
const NOTES: Notes = JSON.parse(fs.readFileSync(notesFile, 'utf8'));

/** The version the running build reports, from Settings › About. */
async function runningVersion(page: Page): Promise<string> {
  await page.goto('/app/settings');
  const line = page.getByRole('main').getByText(/Current version|الإصدار الحالي/).first();
  const text = (await line.textContent()) ?? '';
  const version = text.match(/\d+\.\d+\.\d+/)?.[0];
  expect(version, 'Settings › About shows the running version').toBeTruthy();
  expect(NOTES[version!], `release-notes.json has notes for ${version} (build with MUTABA3A_APP_VERSION)`).toBeTruthy();
  return version!;
}

/** A browser that last ran an older version than this build, before any page script. */
async function asUpgradedBrowser(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('app-last-known-version') === null) localStorage.setItem('app-last-known-version', '0.0.1');
  });
}

const whatsNew = (page: Page, name = "What's new") => page.getByRole('dialog', { name });

test(
  "after an update shows the new version's notes once",
  { tag: '@web.whats-new.after-update' },
  async ({ page, step }) => {
    await asUpgradedBrowser(page);

    await step('Start the app as a browser that last ran an older version', async () => {
      await openFreshApp(page);
    });

    const dialog = whatsNew(page);
    await step("Read What's new", async () => {
      await expect(dialog).toBeVisible();
      const version = (await dialog.locator('bdi').first().textContent()) ?? '';
      await expect(dialog).toContainText(`Version ${version}`);
      await expect(dialog.getByRole('listitem').first()).toHaveText(NOTES[version].en[0]);
    });

    await step('Press Got it', async () => {
      await dialog.getByRole('button', { name: 'Got it' }).click();
      await expect(dialog).toBeHidden();
    });

    await step('Reload: it stays dismissed', async () => {
      await page.reload();
      await expect(page.getByRole('main')).toBeVisible();
      await runningVersion(page);
      await expect(whatsNew(page)).toHaveCount(0);
    });
  },
);

test('a fresh install never shows it', { tag: '@web.whats-new.fresh-install' }, async ({ page, step }) => {
  await step('Start the app in a browser that never ran it', async () => {
    await openFreshApp(page);
  });

  await step('Reload, and confirm notes exist for this version', async () => {
    await page.reload();
    await runningVersion(page);
    await expect(page.getByRole('main').getByRole('button', { name: "What's new" })).toBeVisible();
  });

  await expect(whatsNew(page)).toHaveCount(0);
});

test(
  'Settings › About reopens it, in Arabic and right to left',
  { tag: '@web.whats-new.reopen-arabic' },
  async ({ page, step }) => {
    await openFreshApp(page);
    const version = await runningVersion(page);

    await step('Switch to Arabic', async () => {
      await switchToArabic(page);
    });

    const dialog = whatsNew(page, 'ما الجديد');
    await step('Open Settings › About and press ما الجديد', async () => {
      await page.getByRole('main').getByRole('button', { name: 'ما الجديد' }).click();
      await expect(dialog).toBeVisible();
    });

    await step("Read the version's Arabic notes", async () => {
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(dialog.locator('bdi[dir="ltr"]').first()).toHaveText(version);
      await expect(dialog.getByRole('listitem').first()).toHaveText(NOTES[version].ar[0]);
      await dialog.getByRole('button', { name: 'حسنًا' }).click();
      await expect(dialog).toBeHidden();
    });
  },
);
