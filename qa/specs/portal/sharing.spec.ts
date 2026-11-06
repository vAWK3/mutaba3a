import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, OFFICE_B, malafatFirm, office, FIRM } from '../../support/portal';
import { FakeApi, type StubGrant } from '../../support/portalApi';
import { actAsPerson } from '../../support/posthog';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-561 slice A (epic MUT-558, layout B): the owner's Sharing page on MUT-559's routes. The in-memory API keeps each
 * profile's accountants and answers as the server does (one invite per address, never yourself, the limit). Share
 * links (MUT-560) are off, so the page shows the Accountants column alone.
 */

const PHONE = { width: 375, height: 812 };
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const SAMI: StubGrant = { id: 'a1000001-0000-4000-8000-000000000000', email: 'sami@khoury-cpa.com', name: 'Sami Khoury', status: 'active', invitedAt: ago(26), expiresAt: ago(12), acceptedAt: ago(25), lastViewedAt: ago(2) };
const MAYA: StubGrant = { id: 'a1000002-0000-4000-8000-000000000000', email: 'maya@ledger.co', name: null, status: 'pending', invitedAt: ago(3), expiresAt: ahead(11), acceptedAt: null, lastViewedAt: null };
const HALA: StubGrant = { id: 'a1000003-0000-4000-8000-000000000000', email: 'h.audit@firm.com', name: null, status: 'expired', invitedAt: ago(20), expiresAt: ago(6), acceptedAt: null, lastViewedAt: null };

const studio = () => office(OFFICE_B, 'Studio');
const seeded = (grants: StubGrant[] = [SAMI, MAYA, HALA]) => new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), studio()], accountants: { [OFFICE_B]: grants } });
const sharingPath = `/p/${OFFICE_B}/you/sharing`;
const row = (page: Page, text: string) => page.locator('.hp-sharing-item', { hasText: text });

async function openSharing(page: Page, api: FakeApi, language: 'en' | 'ar' = 'en') {
  await api.open(page, sharingPath, language);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('only an owner, with accountant access on, sees the way into Sharing', { tag: '@portal.sharing.entry' }, async ({ page, step }) => {
  await step('Open You › Profiles as the owner of Studio', async () => {
    await seeded().open(page, `/p/${OFFICE_B}/payments`);
    await openYou(page, 'profiles');
    const entry = page.getByRole('link', { name: /Share with your accountant/ });
    await expect(entry).toContainText('Studio');
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`${sharingPath}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Sharing Studio' })).toBeVisible();
  });

  await step('Back to Profiles, open Manage profiles and edit Studio: its Sharing row opens the same page', async () => {
    // The Sharing page lights the You island, so its own back link returns to You › Profiles
    await page.getByRole('main').getByRole('link', { name: /Profiles/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/you$`));
    await youRow(page, 'Manage profiles').click();
    await page.getByRole('dialog', { name: 'Profiles' }).getByRole('button', { name: /^Studio/ }).click();
    await page.getByRole('dialog', { name: 'Studio' }).getByRole('link', { name: /^Sharing/ }).click();
    await expect(page).toHaveURL(new RegExp(`${sharingPath}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  await step("Open You › Profiles on a firm profile you're only a member of", async () => {
    const member = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), malafatFirm()], accountants: {} });
    await member.open(page, `/p/${FIRM}/payments`);
    await openYou(page, 'profiles');
    await expect(youRow(page, 'Manage profiles')).toBeVisible();
    await expect(page.getByRole('link', { name: /Share with your accountant/ })).toHaveCount(0);
    await page.goto(`/p/${FIRM}/you/sharing`);
    await expect(page).toHaveURL(new RegExp(`/p/${FIRM}/you$`));
  });

  await step('Open You › Profiles on a server with accountant access off', async () => {
    const off = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), studio()] });
    await off.open(page, `/p/${OFFICE_B}/payments`);
    await openYou(page, 'profiles');
    await expect(youRow(page, 'Manage profiles')).toBeVisible();
    await expect(page.getByRole('link', { name: /Share with your accountant/ })).toHaveCount(0);
    await page.goto(sharingPath);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/you$`));
  });
});

test("the Accountants column shows each accountant's state and one action", { tag: '@portal.sharing.accountants-list' }, async ({ page, step }) => {
  await step('Open Sharing on Studio, which has an active, a pending and an expired accountant', async () => {
    await openSharing(page, seeded());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing Studio');
    await expect(page.getByText("Whoever you share with reads expenses, income and receipts only. They can't add or change anything.")).toBeVisible();

    const sami = row(page, 'Sami Khoury');
    await expect(sami).toContainText('Active');
    await expect(sami).toContainText(/Since .+ · viewed 2 days ago/);
    await expect(sami.getByRole('button', { name: "Stop Sami Khoury's access" })).toBeVisible();

    const maya = row(page, 'maya@ledger.co');
    await expect(maya).toContainText('Pending');
    await expect(maya).toContainText(/Sent .+ · ends .+/);
    await expect(maya.getByRole('button', { name: 'Cancel the invite to maya@ledger.co' })).toBeVisible();

    const hala = row(page, 'h.audit@firm.com');
    await expect(hala).toContainText('Expired');
    await expect(hala).toContainText('Not accepted within 14 days');
    await expect(hala.getByRole('button', { name: 'Invite h.audit@firm.com again' })).toBeVisible();

    await expect(page.getByText('Up to 5 accountants per profile.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Links/ })).toHaveCount(0);
  });
});

test("invite an accountant by email, in the portal's language, with every refusal in its place", { tag: '@portal.sharing.invite' }, async ({ page, step, analytics }) => {
  const api = seeded([SAMI]);
  const drawer = page.getByRole('dialog', { name: 'Invite an accountant' });
  const email = drawer.getByLabel('Email');
  const send = page.getByRole('button', { name: 'Send invite' });

  await step('With usage counts on, open Sharing and press Invite by email', async () => {
    await actAsPerson(page);
    await api.open(page, `/p/${OFFICE_B}/payments`);
    await page.getByRole('region', { name: 'Share anonymous usage?' }).getByRole('button', { name: 'Share anonymous usage' }).click();
    await expect.poll(() => analytics.events().some((e) => e.event === 'analytics_opted_in'), { timeout: 15_000 }).toBe(true);
    await page.goto(sharingPath);
    await page.getByRole('button', { name: 'Invite by email' }).click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/invite=true/);
    await expect(drawer.getByRole('list', { name: 'What whoever you share with can do' }).getByRole('listitem')).toHaveCount(4);
    await expect(email).toHaveAttribute('dir', 'ltr');
  });

  await step('Send your own address', async () => {
    await email.fill('nour@office.ps');
    await send.click();
    await expect(drawer.getByText("That's your own email. Use your accountant's.")).toBeVisible();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
  });

  await step('Send an address already invited', async () => {
    await email.fill('sami@khoury-cpa.com');
    await send.click();
    await expect(drawer.getByRole('alert')).toHaveText('sami@khoury-cpa.com already has an invite or access to this profile.');
  });

  await step('Send a new address', async () => {
    await email.fill('maya@ledger.co');
    await send.click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByText('Invite sent to maya@ledger.co')).toBeVisible();
    await expect(row(page, 'maya@ledger.co')).toContainText('Pending');
    expect(api.last('POST', /\/accountants$/)?.body).toEqual({ email: 'maya@ledger.co', locale: 'en' });
    await expect.poll(() => analytics.events().some((e) => e.event === 'accountant_invited'), { timeout: 15_000 }).toBe(true);
    const event = analytics.events().find((e) => e.event === 'accountant_invited')!;
    expect(JSON.stringify(event)).not.toMatch(/maya|ledger|Studio|22222222/);
  });
});

test('stop an accountant, cancel an invite, or invite an expired one again', { tag: '@portal.sharing.revoke-access' }, async ({ page, step }) => {
  const api = seeded();

  await step('Open Sharing and press Stop on Sami Khoury', async () => {
    await openSharing(page, api);
    await row(page, 'Sami Khoury').getByRole('button', { name: "Stop Sami Khoury's access" }).click();
    const confirm = page.getByRole('group', { name: /Stop Sami Khoury's access to Studio\?/ });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  await step('Confirm Stop access', async () => {
    await page.getByRole('button', { name: 'Stop access' }).click();
    await expect(row(page, 'Sami Khoury')).toHaveCount(0);
    await expect(page.getByText('Sami Khoury can no longer open Studio')).toBeVisible();
    expect(api.calls('DELETE', new RegExp(`/accountants/${SAMI.id}$`))).toHaveLength(1);
  });

  await step('Press Cancel on maya@ledger.co and confirm Cancel invite', async () => {
    await row(page, 'maya@ledger.co').getByRole('button', { name: 'Cancel the invite to maya@ledger.co' }).click();
    await page.getByRole('button', { name: 'Cancel invite' }).click();
    await expect(row(page, 'maya@ledger.co')).toHaveCount(0);
    await expect(page.getByText('Invite to maya@ledger.co cancelled')).toBeVisible();
  });

  await step('Press Invite again on h.audit@firm.com', async () => {
    await row(page, 'h.audit@firm.com').getByRole('button', { name: 'Invite h.audit@firm.com again' }).click();
    await expect(row(page, 'h.audit@firm.com')).toContainText('Pending');
    expect(api.last('POST', /\/accountants$/)?.body).toEqual({ email: 'h.audit@firm.com', locale: 'en' });
  });
});

test('a profile shared with nobody explains sharing and offers the way to start', { tag: '@portal.sharing.empty' }, async ({ page, step }) => {
  await step('Open Sharing on a profile shared with nobody', async () => {
    await openSharing(page, seeded([]));
    await expect(page.getByRole('heading', { name: "You haven't shared this profile yet" })).toBeVisible();
    await expect(page.locator('[data-scene="accountant-empty"] svg')).toBeVisible();
    await expect(page.getByRole('list', { name: 'What whoever you share with can do' }).getByRole('listitem')).toHaveText([
      'Sees this profile’s expenses, income and receipts',
      'Can download them for a period',
      'Can’t add, change or delete anything',
      'Doesn’t see your other profiles or your account',
    ]);
    await expect(page.getByRole('main').getByRole('button', { name: 'Invite by email' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /link/i })).toHaveCount(0);
  });
});

test('Arabic at 375px is one column with no sideways scroll; desktop passes axe', { tag: '@portal.sharing.layout' }, async ({ page, step }) => {
  await step('On a 375px phone in Arabic, open Sharing with three accountants', async () => {
    await page.setViewportSize(PHONE);
    await openSharing(page, seeded(), 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشاركة «Studio»');
    await expect(row(page, 'sami@khoury-cpa.com').locator('bdi')).toHaveAttribute('dir', 'ltr');
    await expectNoHorizontalOverflow(page, 'Sharing, Arabic, 375px');
  });

  await step('Open the invite drawer', async () => {
    await page.getByRole('button', { name: 'دعوة بالبريد' }).click();
    const drawer = page.getByRole('dialog', { name: 'دعوة محاسب' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('البريد الإلكتروني')).toHaveAttribute('dir', 'ltr');
    await expectNoHorizontalOverflow(page, 'Invite drawer, Arabic, 375px');
  });

  await step('On a desktop in English and dark mode, open Sharing', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openSharing(page, seeded());
    await expect(row(page, 'Sami Khoury')).toBeVisible();
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn', '.hp-sharing');
  });
});
