import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { address, chooseLanguage, grantFeature, operatorAccount, signInThroughForm } from '../../support/selfService';
import { connectMalafat, malafatAs, malafatSeat, OFFICE, startMalafatSignIn, type MalafatPerson } from '../../support/malafat';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-596 (brief §12): Malafat runs MTB3A through the lawyer's own access, on the live dev API and the Malafat stub
 * office (support/malafat.ts). Each test makes its own people as seats of the stub's firm.
 */

const PASSWORD = 'the lawyer’s own long passphrase';

/** A new account's first-run trial step (MUT-418): Continue, as everyone does. */
async function passTrialWelcome(page: Page) {
  const trial = page.getByRole('dialog', { name: 'Your free trial' });
  await trial.getByRole('button', { name: 'Continue' }).click();
  await expect(trial).toHaveCount(0);
}

/** The stub signs the page in as `person`, a first time: consent with a currency, landing signed in. */
async function firstSignIn(page: Page, person: MalafatPerson) {
  await malafatAs(page, person);
  await startMalafatSignIn(page);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByRole('checkbox', { name: /terms of service/ }).check();
  await page.getByRole('button', { name: 'Create account and continue' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/);
  await passTrialWelcome(page);
}

async function meOf(page: Page): Promise<{ user: { id: string }; profiles: Array<{ id: string; name: string }> }> {
  const res = await page.request.get('/v1/me');
  expect(res.ok()).toBe(true);
  return res.json();
}

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
});

test('A lawyer new to MTB3A signs in with Malafat; the consent creates the account in their office', { tag: '@portal-selfservice.malafat-delegation.first-sign-in' }, async ({ page, step }) => {
  const person = await malafatSeat('ASSOCIATE', 'nadia');
  await malafatAs(page, person);
  await step('On sign-in press Sign in with Malafat and type the office address', async () => {
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Sign in with Malafat' })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in with Malafat' }).click();
    await page.getByLabel('Your Malafat office address').fill(`https://${OFFICE.slug}.malafat.app/`);
    await page.getByRole('button', { name: 'Continue to Malafat' }).click();
  });
  await step('Allow MTB3A in Malafat: the consent names the office and says nothing is saved yet', async () => {
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(page.getByText(OFFICE.name)).toBeVisible();
    await expect(page.getByText(new RegExp(`We'll create an MTB3A account for ${person.email}`))).toBeVisible();
    await expect(page.getByText(/Nothing is saved until you continue/)).toBeVisible();
    await expect(page).not.toHaveURL(/result=/);
  });
  await step('Choose the currency, agree to the terms and press Create account and continue', async () => {
    await page.getByLabel('Base currency').selectOption('USD');
    await page.getByRole('checkbox', { name: /terms of service/ }).check();
    await page.getByRole('button', { name: 'Create account and continue' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: "We've updated our terms" })).toHaveCount(0);
    await passTrialWelcome(page);
  });
  await step('Signed in, with the office beside the personal profile', async () => {
    const me = await meOf(page);
    expect(me.profiles.map((p) => p.id)).toContain(person.organizationId);
    await openYou(page, 'profiles');
    await expect(youRow(page, OFFICE.name)).toBeVisible();
  });
  await step('Home offers a second way to sign in, beside Malafat', async () => {
    await page.goto('/');
    await expect(page.getByText('Add a second way to sign in')).toBeVisible();
    await expect(page.getByText(/next to Malafat/)).toBeVisible();
  });
});

test('A lawyer who already has MTB3A proves their account once, then Malafat signs them in', { tag: '@portal-selfservice.malafat-delegation.link-existing' }, async ({ page, step }) => {
  const person = await malafatSeat('PARTNER', 'samer');
  await operatorAccount(person.email, 'en', PASSWORD, person.name);
  await malafatAs(page, person);
  await step('Sign in with Malafat with an email that already has an MTB3A account', async () => {
    await startMalafatSignIn(page);
    await expect(page.getByRole('heading', { name: 'You already have an MTB3A account' })).toBeVisible();
    await expect(page.getByText('We never connect two accounts by email alone.')).toBeVisible();
  });
  await step('A wrong MTB3A password is said so', async () => {
    await page.getByLabel('Your MTB3A password').fill('not the password at all');
    await page.getByRole('button', { name: 'Connect the accounts' }).click();
    await expect(page.getByText("That password doesn't match this account.")).toBeVisible();
  });
  await step('Type the right password, then press Connect and continue', async () => {
    await page.getByLabel('Your MTB3A password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Connect the accounts' }).click();
    await page.getByRole('button', { name: 'Connect and continue' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/);
  });
  await step('The same account shows the office beside its own profile', async () => {
    const me = await meOf(page);
    expect(me.profiles.map((p) => p.id)).toContain(person.organizationId);
    expect(me.profiles.length).toBeGreaterThan(1);
  });
});

test('Declining in Malafat changes nothing and says so', { tag: '@portal-selfservice.malafat-delegation.declined' }, async ({ page, step }) => {
  const person = await malafatSeat('ASSOCIATE', 'dana');
  await malafatAs(page, person, { deny: true });
  await step('Sign in with Malafat and press Deny in Malafat', async () => {
    await startMalafatSignIn(page);
  });
  await step('"Nothing was changed", with a way back to sign in', async () => {
    await expect(page.getByText("You didn't allow MTB3A in Malafat. Nothing was changed.")).toBeVisible();
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test('A partner invites the office’s accountant from the portal; an associate has no invite control', { tag: '@portal-selfservice.malafat-delegation.partner-invites-accountant' }, async ({ page, browser, step }) => {
  const partner = await malafatSeat('PARTNER', 'rana');
  await firstSignIn(page, partner);
  await grantFeature((await meOf(page)).user.id, 'accountant_access');
  await step("As a partner, open the office's Sharing and invite an accountant", async () => {
    await page.goto(`/p/${partner.organizationId}/you/sharing`);
    await page.getByRole('button', { name: 'Invite by email' }).click();
    const accountant = address('accountant', 'khoury-cpa.com');
    await page.getByRole('dialog', { name: 'Invite an accountant' }).getByLabel(/email/i).fill(accountant);
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText(new RegExp(`Invite sent to .?${accountant.replace(/[.]/g, '\\.')}`))).toBeVisible();
  });
  await step('As an associate in the same office, there is no Share with your accountant', async () => {
    const other = await browser.newContext();
    const associatePage = await other.newPage();
    await chooseLanguage(associatePage, 'en');
    const associate = await malafatSeat('ASSOCIATE', 'omar');
    await firstSignIn(associatePage, associate);
    await grantFeature((await meOf(associatePage)).user.id, 'accountant_access');
    await associatePage.goto(`/p/${associate.organizationId}/you`);
    await expect(youRow(associatePage, OFFICE.name)).toBeVisible();
    await expect(associatePage.getByRole('link', { name: /Share with your accountant/ })).toHaveCount(0);
    await other.close();
  });
});

// Basel, 2026-11-13: "own list only" and "no firm totals" are MUT-305's (firm roles are inert until it lands, ADR-099).
test('An associate records an expense on the office', { tag: '@portal-selfservice.malafat-delegation.submitter-expense' }, async ({ page, step }) => {
  const associate = await malafatSeat('ASSOCIATE', 'hadi');
  await firstSignIn(page, associate);
  await step("As an associate, open the office's Expenses and record an expense", async () => {
    await page.goto(`/p/${associate.organizationId}/expenses`);
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Amount').fill('12.50');
    await drawer.getByLabel('Category').selectOption({ index: 1 });
    await drawer.getByLabel('Title').fill('Associate filing stamp');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });
  await step('Their expense is listed on the office', async () => {
    await expect(page.getByRole('row', { name: /Associate filing stamp/ })).toBeVisible();
  });
});

test('The office’s income is Malafat’s to change; the portal says so', { tag: '@portal-selfservice.malafat-delegation.ledger-read-only' }, async ({ page, step }) => {
  const partner = await malafatSeat('PARTNER', 'karim');
  await firstSignIn(page, partner);
  await step("As a partner, open the office's Income", async () => {
    await page.goto(`/p/${partner.organizationId}/receivables`);
  });
  await step('It is edited in Malafat, with nothing to record or edit here', async () => {
    await expect(page.getByText('Malafat records income and payments for this profile. To change them, use Malafat.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Record income|Add income/ })).toHaveCount(0);
  });
});

test('You › Connected apps lists Malafat per office, and disconnecting removes it', { tag: '@portal-selfservice.malafat-delegation.connected-apps' }, async ({ page, step }) => {
  const partner = await malafatSeat('PARTNER', 'yara');
  await firstSignIn(page, partner);
  await connectMalafat(page);
  await step('With Malafat connected, open You › Account › Connected apps', async () => {
    await page.goto('/');
    await openYou(page, 'account');
    await youRow(page, 'Connected apps').click();
  });
  const drawer = page.getByRole('dialog', { name: 'Connected apps' });
  await step('Malafat is listed with the office, its mark and since when', async () => {
    await expect(drawer.getByText(OFFICE.name)).toBeVisible();
    await expect(drawer.locator('.hp-malafat-mark')).toBeVisible();
    await expect(drawer.getByRole('listitem').getByText(/^Connected /)).toBeVisible();
  });
  await step('Press Disconnect on the office, then Disconnect in the confirm', async () => {
    await drawer.getByRole('button', { name: `Disconnect: ${OFFICE.name}` }).click();
    await expect(drawer.getByText(new RegExp(`Disconnect Malafat from ${OFFICE.name}\\?`))).toBeVisible();
    await drawer.getByRole('button', { name: 'Disconnect', exact: true }).click();
  });
  await step('Disconnected: the toast says so and the row is gone', async () => {
    await expect(page.getByText(`Malafat is disconnected from ${OFFICE.name}.`)).toBeVisible();
    await expect(drawer.getByText('No apps act for you.')).toBeVisible();
  });
});

test('The office’s members are managed in Malafat, listed read-only', { tag: '@portal-selfservice.malafat-delegation.members' }, async ({ page, step }) => {
  const partner = await malafatSeat('PARTNER', 'salma');
  const pending = await malafatSeat('INTERN', 'tariq');
  await firstSignIn(page, partner);
  await step("On the office's profile, open You › Profiles", async () => {
    await page.goto(`/p/${partner.organizationId}/you`);
  });
  await step('Members with their Malafat roles, managed in Malafat, and no controls', async () => {
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'Members' }) });
    await expect(section.getByText("This office's name and members are managed in Malafat.")).toBeVisible();
    await expect(section.getByText(partner.name)).toBeVisible();
    await expect(section.getByText('(you)')).toBeVisible();
    await expect(section.getByText(pending.email)).toBeVisible();
    await expect(section.getByText("Intern · hasn't signed in yet")).toBeVisible();
    await expect(section.getByRole('button')).toHaveCount(0);
  });
});

test('An account Malafat made sets its own password with no current one, and the suggestion goes', { tag: '@portal-selfservice.malafat-delegation.second-way-in' }, async ({ page, step }) => {
  const person = await malafatSeat('ASSOCIATE', 'mona');
  await firstSignIn(page, person);
  await step('After a first sign-in with Malafat, press Set a password on Home', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Set a password' }).click();
  });
  const drawer = page.getByRole('dialog', { name: 'Set a password' });
  await step('No current password is asked for; type a new one and save', async () => {
    await expect(drawer.getByLabel('Current password')).toHaveCount(0);
    await drawer.getByLabel('New password').fill(PASSWORD);
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);
  });
  await step('The suggestion is gone, and the email and that password sign in', async () => {
    await expect(page.getByText('Add a second way to sign in')).toHaveCount(0);
    await page.context().clearCookies({ domain: 'localhost' });
    await signInThroughForm(page, person.email, PASSWORD);
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/);
  });
});
