import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, openNewIncomeDrawer } from '../../support/app';

// Drawers on springs (MUT-80, brief R2). jsdom has no layout, so the motion
// itself is proven here: the exit after a close, drag to dismiss, and the
// mirrored edge in Arabic.

interface ExitTrace {
  added: boolean;
  removed: boolean;
  minX: number;
  maxX: number;
}

/** Record the exit snapshot (the hidden clone) frame by frame from the moment it is added. */
async function traceExit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trace: ExitTrace = { added: false, removed: false, minX: 0, maxX: 0 };
    (window as unknown as { __exit: ExitTrace }).__exit = trace;
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.matches('.drawer[aria-hidden="true"]')) return;
          trace.added = true;
          const tick = () => {
            const match = /translateX\((-?[\d.]+)px\)/.exec(node.style.transform);
            if (match) {
              trace.minX = Math.min(trace.minX, Number(match[1]));
              trace.maxX = Math.max(trace.maxX, Number(match[1]));
            }
            if (node.isConnected) requestAnimationFrame(tick);
            else trace.removed = true;
          };
          tick();
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

const exitTrace = (page: Page) => page.evaluate(() => (window as unknown as { __exit: ExitTrace }).__exit);

async function atRest(drawer: Locator) {
  await expect.poll(() => drawer.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
}

/** Drag from the drawer's title by `dx`, slowly enough that the release has no momentum. */
async function dragTitle(page: Page, drawer: Locator, dx: number) {
  const title = await drawer.locator('.drawer-title').boundingBox();
  if (!title) throw new Error('drawer title not laid out');
  const x = title.x + title.width / 2;
  const y = title.y + title.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test(
  'Escape closes the dialog at once, and its snapshot slides out to the trailing edge',
  { tag: '@web.drawer-motion.escape-exit' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    const drawer = await openNewIncomeDrawer(page);
    await atRest(drawer);
    await traceExit(page);

    await step('Press Escape', async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    await step('Check the exit snapshot slid past 400px before being removed', async () => {
      await expect.poll(() => exitTrace(page), { timeout: 2000 }).toMatchObject({ added: true, removed: true });
      expect((await exitTrace(page)).maxX).toBeGreaterThan(400);
      await expect(page.locator('.drawer, .drawer-overlay')).toHaveCount(0);
    });
  },
);

test(
  'a drag past half the width closes it; a shorter one springs back',
  { tag: '@web.drawer-motion.drag-dismiss' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    const drawer = await openNewIncomeDrawer(page);
    await atRest(drawer);

    await step('Drag the title by 120px and release', async () => {
      await dragTitle(page, drawer, 120);
      await atRest(drawer);
      await expect(drawer).toBeVisible();
    });

    await step('Drag the title by 320px and release', async () => {
      await dragTitle(page, drawer, 320);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  },
);

test(
  'in Arabic the drawer sits on the left and a drag to the left closes it',
  { tag: '@web.drawer-motion.rtl-mirror' },
  async ({ page, step }) => {
    await step('Switch language to Arabic', async () => {
      await openFreshApp(page, '/settings');
      await page.getByRole('button', { name: 'العربية' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    });

    let drawer = page.getByRole('dialog');
    await step('Open the New Income drawer', async () => {
      await page.goto('/app/income');
      await page.getByRole('button', { name: 'إضافة إيراد' }).click();
      drawer = page.getByRole('dialog').filter({ hasText: 'إيراد جديد' });
      await atRest(drawer);
      expect((await drawer.boundingBox())?.x).toBe(0);
    });

    await step('Drag the title left', async () => {
      await dragTitle(page, drawer, -320);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  },
);
