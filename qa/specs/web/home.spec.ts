import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, openNewIncomeDrawer, localDateFromToday, switchToArabic } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { traceExit, readExitTrace } from '../../support/motion';
import { ar } from '../../support/i18n';

test('a fresh install\'s Home shows Get Started', { tag: '@web.home.first-run' }, async ({ page, step }) => {
  await step('Open a fresh install at /', async () => {
    await openFreshApp(page, '/');
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeVisible();
  });

  await step('Check accessibility', async () => {
    await expectOnlyKnownAxeViolations(page, 'homeFirstRun');
  });
});

// MUT-83 (ADR-049): Owed now on Home and on Clients always match. Income with no
// client is counted on both, shown on Clients as a muted "No client" row.
test(
  "Needs Attention's Owed Now matches Clients, including entries with no client",
  { tag: '@web.home.needs-attention-owed-now' },
  async ({ page, step }) => {
    await step('Log one income entry for a client and one with no client', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

      const drawer = await openNewIncomeDrawer(page);
      await drawer.getByLabel('What did you do?').fill('Walk-in job');
      await drawer.getByLabel(/^Amount/).fill('300');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await step('Open Home and read Owed Now', async () => {
      await page.goto('/app/');
      await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
      const owedNow = await page
        .getByRole('region', { name: 'Owed now' })
        .getByTestId('owed-now-amount')
        .allTextContents();
      expect(owedNow).toEqual(['$1,500']);
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'home');
    });
  },
);

// MUT-82 (brief H1, ADR-055): record a payment straight from Needs attention.
// jsdom has no layout, so the slide-out itself is proven here: the paid row's
// copy moves toward the inline end and goes, or only fades under reduced
// motion, while the row and Owed now change together.

/** The paid row's copy while it plays out (`ROW_EXIT_CLASS`, src/lib/motion/rowExit.ts) */
const ROW_EXIT = '.row-exit';

const attention = (page: Page, name = 'Needs Attention') => page.getByRole('region', { name });
const attentionRow = (page: Page, client: string) => attention(page).getByRole('row').filter({ hasText: client });
const owedNow = (page: Page) => page.getByRole('region', { name: 'Owed now' }).getByTestId('owed-now-amount');

/** Home with two entries on Needs attention: Acme Studio $1,200 overdue, Beta Labs $300 due in 2 days */
async function openHomeWithTwoEntries(page: Page) {
  await openFreshApp(page, '/income');
  await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio', dueDate: localDateFromToday(-5) });
  await logIncome(page, { title: 'Brand book', amount: '300', client: 'Beta Labs', dueDate: localDateFromToday(2) });
  await page.goto('/app/');
  await expect(attentionRow(page, 'Acme Studio')).toBeVisible();
  await expect(owedNow(page)).toHaveText('$1,500');
}

/** Record Payment on a row opens the drawer prefilled with what is left, the amount focused */
async function openPaymentFromRow(page: Page, client: string, left: string): Promise<Locator> {
  await attentionRow(page, client).getByRole('button', { name: `Record Payment — Remaining: ${left}` }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { level: 2 })).toContainText(left);
  await expect(drawer.getByLabel('Payment amount')).toBeFocused();
  return drawer;
}

const submitPayment = (drawer: Locator) => drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();

test(
  'a full payment from Needs attention slides the row out and lowers Owed now; Undo brings both back',
  { tag: '@web.home.attention-pay-full' },
  async ({ page, step }) => {
    await step('Log two entries due soon: Acme Studio overdue, Beta Labs in 2 days', () => openHomeWithTwoEntries(page));

    await step('Check accessibility with Record Payment on the rows', async () => {
      await expectOnlyKnownAxeViolations(page, 'home');
    });

    await traceExit(page, ROW_EXIT);
    const drawer = await step("Click Record Payment on Acme Studio's row", () =>
      openPaymentFromRow(page, 'Acme Studio', '$1,200'),
    );

    await step('Record the full amount', async () => {
      await submitPayment(drawer);
      await expect(drawer).toBeHidden();
      await expect(attentionRow(page, 'Acme Studio')).toHaveCount(0);
      await expect(owedNow(page)).toHaveText('$300');
    });

    await step('Check the row slid out and focus moved to the next row', async () => {
      await expect.poll(() => readExitTrace(page), { timeout: 3000 }).toMatchObject({ added: true, removed: true });
      const trace = await readExitTrace(page);
      expect(trace.maxX).toBeGreaterThan(100);
      expect(trace.minOpacity).toBeLessThan(0.5);
      await expect(attentionRow(page, 'Beta Labs').getByRole('button', { name: /^Record Payment/ })).toBeFocused();
    });

    await step('Click Undo on the toast', async () => {
      const toast = page.getByRole('status').filter({ hasText: 'Recorded' });
      // The amount and the name sit in bidi isolates inside the sentence
      await expect(toast).toContainText(/Recorded\W+\$1,200\W+from\W+Acme Studio/);
      await toast.getByRole('button', { name: 'Undo' }).click();

      await expect(attentionRow(page, 'Acme Studio')).toBeVisible();
      await expect(owedNow(page)).toHaveText('$1,500');
      await expect(
        attentionRow(page, 'Acme Studio').getByRole('button', { name: 'Record Payment — Remaining: $1,200' }),
      ).toBeFocused();
    });
  },
);

test(
  'a partial payment from Needs attention keeps the row with what is still left',
  { tag: '@web.home.attention-pay-partial' },
  async ({ page, step }) => {
    await openHomeWithTwoEntries(page);
    const drawer = await step("Click Record Payment on Acme Studio's row", () =>
      openPaymentFromRow(page, 'Acme Studio', '$1,200'),
    );

    await step('Replace the amount with $200 and record it', async () => {
      // The prefill is selected, so typing replaces it
      await page.keyboard.type('200');
      await submitPayment(drawer);
      await expect(drawer).toBeHidden();
    });

    await step('Check the row now shows $1,000 left and Owed now dropped by $200', async () => {
      await expect(
        attentionRow(page, 'Acme Studio').getByRole('button', { name: 'Record Payment — Remaining: $1,000' }),
      ).toBeVisible();
      await expect(owedNow(page)).toHaveText('$1,300');
    });
  },
);

test(
  'under reduced motion the paid row only fades',
  { tag: '@web.home.attention-pay-reduced-motion' },
  async ({ page, step }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHomeWithTwoEntries(page);
    await traceExit(page, ROW_EXIT);

    await step("Record the full amount on Acme Studio's row, with reduced motion on", async () => {
      const drawer = await openPaymentFromRow(page, 'Acme Studio', '$1,200');
      await submitPayment(drawer);
      await expect(attentionRow(page, 'Acme Studio')).toHaveCount(0);
    });

    await step('Check the row faded without moving', async () => {
      await expect.poll(() => readExitTrace(page), { timeout: 3000 }).toMatchObject({ added: true, removed: true });
      const trace = await readExitTrace(page);
      expect(trace.minX).toBe(0);
      expect(trace.maxX).toBe(0);
      expect(trace.minOpacity).toBeLessThan(1);
    });
  },
);

test(
  'in Arabic the paid row slides toward the left',
  { tag: '@web.home.attention-pay-rtl' },
  async ({ page, step }) => {
    await openHomeWithTwoEntries(page);

    const acme = attention(page, ar.overview.needsAttention).getByRole('row').filter({ hasText: 'Acme Studio' });
    await step('Switch to Arabic and open Home', async () => {
      await switchToArabic(page);
      await page.goto('/app/');
      await expect(acme).toBeVisible();
    });

    await traceExit(page, ROW_EXIT);
    await step("Record the full amount on Acme Studio's row", async () => {
      // The client cell is a link, so the row's one button is Record Payment
      await acme.getByRole('button').click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByLabel(ar.transactions.partialPayment.amount)).toBeFocused();
      await drawer.getByRole('button', { name: ar.transactions.partialPayment.record, exact: true }).click();
      await expect(acme).toHaveCount(0);
    });

    await step('Check the row slid out to the left', async () => {
      await expect.poll(() => readExitTrace(page), { timeout: 3000 }).toMatchObject({ added: true, removed: true });
      expect((await readExitTrace(page)).minX).toBeLessThan(-100);
    });
  },
);
