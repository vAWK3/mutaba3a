import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, OFFICE_B, malafatFirm, office, FIRM } from '../../support/portal';
import { FakeApi, type StubGrant, type StubShareLink } from '../../support/portalApi';
import { actAsPerson } from '../../support/posthog';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-561 slice A (epic MUT-558, layout B): the owner's Sharing page on MUT-559's routes. The in-memory API keeps each
 * profile's accountants and answers as the server does (one invite per address, never yourself, the limit). Share
 * links (MUT-560) are off, so the page shows the Accountants column alone.
 */

const PHONE = { width: 375, height: 812 };
/** Review fix (d): a person's text inside a sentence is isolated (FSI … PDI). */
const iso = (text: string) => `\u2068${text}\u2069`;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const SAMI: StubGrant = { id: 'a1000001-0000-4000-8000-000000000000', email: 'sami@khoury-cpa.com', name: 'Sami Khoury', status: 'active', invitedAt: ago(26), expiresAt: ago(12), acceptedAt: ago(25), lastViewedAt: ago(2) };
const MAYA: StubGrant = { id: 'a1000002-0000-4000-8000-000000000000', email: 'maya@ledger.co', name: null, status: 'pending', invitedAt: ago(3), expiresAt: ahead(11), acceptedAt: null, lastViewedAt: null };
const HALA: StubGrant = { id: 'a1000003-0000-4000-8000-000000000000', email: 'h.audit@firm.com', name: null, status: 'expired', invitedAt: ago(20), expiresAt: ago(6), acceptedAt: null, lastViewedAt: null };

const studio = () => office(OFFICE_B, 'Studio');
const seeded = (grants: StubGrant[] = [SAMI, MAYA, HALA], links?: StubShareLink[]) =>
  new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), studio()], accountants: { [OFFICE_B]: grants }, ...(links ? { shareLinks: { [OFFICE_B]: links } } : {}) });

const LIVE: StubShareLink = { id: 'b1000001-0000-4000-8000-000000000000', period: 'LAST_3_MONTHS', from: '2026-08-01', to: '2026-10-31', createdAt: ago(1), expiresAt: ahead(6), lastOpenedAt: ago(1), status: 'active', endedAt: null, viewers: 2, maxViewers: 3, createdByName: 'Nour Haddad' };
const LOCKED: StubShareLink = { ...LIVE, id: 'b1000002-0000-4000-8000-000000000000', period: 'WHOLE_PROFILE', from: null, to: '2026-11-01', status: 'locked', endedAt: ago(0.2), lastOpenedAt: null, viewers: 0 };
const ENDED: StubShareLink = { ...LIVE, id: 'b1000003-0000-4000-8000-000000000000', period: 'LAST_1_MONTH', from: '2026-09-01', to: '2026-09-30', status: 'expired', endedAt: ago(0.5), viewers: 3 };
const linkRow = (page: Page, text: string | RegExp) => page.getByRole('table', { name: 'Links with a PIN' }).getByRole('row').filter({ hasText: text });
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
    await expect(page.getByRole('heading', { level: 1, name: `Sharing ${iso('Studio')}` })).toBeVisible();
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

  await step('Open You › Profiles as an owner without the accountant_access feature (MUT-577)', async () => {
    const unfeatured = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), studio()], accountants: {}, accountantAccess: false });
    await unfeatured.open(page, `/p/${OFFICE_B}/payments`);
    await openYou(page, 'profiles');
    await expect(youRow(page, 'Manage profiles')).toBeVisible();
    await expect(page.getByRole('link', { name: /Share with your accountant/ })).toHaveCount(0);
    await page.goto(sharingPath);
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_B}/you$`));
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Sharing ${iso('Studio')}`);
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
    await expect(drawer.getByRole('alert')).toHaveText(`${iso('sami@khoury-cpa.com')} already has an invite or access to this profile.`);
  });

  await step('Send a new address', async () => {
    await email.fill('maya@ledger.co');
    await send.click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByText(`Invite sent to ${iso('maya@ledger.co')}`)).toBeVisible();
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
    const confirm = page.getByRole('group', { name: `Stop ${iso('Sami Khoury')}'s access to ${iso('Studio')}? ${iso('Sami Khoury')} won't be able to open it any more. You can send a new invite later.` });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  await step('Confirm Stop access', async () => {
    await page.getByRole('button', { name: 'Stop access' }).click();
    await expect(row(page, 'Sami Khoury')).toHaveCount(0);
    await expect(page.getByText(`${iso('Sami Khoury')} can no longer open ${iso('Studio')}`)).toBeVisible();
    expect(api.calls('DELETE', new RegExp(`/accountants/${SAMI.id}$`))).toHaveLength(1);
  });

  await step('Press Cancel on maya@ledger.co and confirm Cancel invite', async () => {
    await row(page, 'maya@ledger.co').getByRole('button', { name: 'Cancel the invite to maya@ledger.co' }).click();
    await page.getByRole('button', { name: 'Cancel invite' }).click();
    await expect(row(page, 'maya@ledger.co')).toHaveCount(0);
    await expect(page.getByText(`Invite to ${iso('maya@ledger.co')} cancelled`)).toBeVisible();
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
    await expect(page.locator('[data-scene-art="accountant-empty"]:not([data-placeholder]) svg')).toBeVisible();
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
    await openSharing(page, seeded(undefined, [LIVE, LOCKED]), 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`مشاركة «${iso('Studio')}»`);
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
    await openSharing(page, seeded(undefined, [LIVE, LOCKED, ENDED]));
    await expect(row(page, 'Sami Khoury')).toBeVisible();
    await expect(page.locator('.hp-sharing-columns > .hp-sharing-column')).toHaveCount(2);
    await expectOnlyKnownAxeViolations(page, 'portalSignedIn', '.hp-sharing');
  });
});

test('make a link with a PIN: whole months by name, the link once, Copy message without the PIN, gone after Done', { tag: '@portal.sharing.create-link' }, async ({ page, step, context, analytics }) => {
  const api = seeded([SAMI], []);
  const drawer = page.getByRole('dialog', { name: 'New link' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await step('With usage counts on, open Sharing and press Create link', async () => {
    await actAsPerson(page);
    await api.open(page, `/p/${OFFICE_B}/payments`);
    await page.getByRole('region', { name: 'Share anonymous usage?' }).getByRole('button', { name: 'Share anonymous usage' }).click();
    await expect.poll(() => analytics.events().some((e) => e.event === 'analytics_opted_in'), { timeout: 15_000 }).toBe(true);
    await page.goto(sharingPath);
    await page.getByRole('button', { name: 'Create link' }).click();
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/newLink=true/);
    const periods = drawer.getByRole('group', { name: 'Period' }).locator('label');
    await expect(periods).toHaveText([/^Last month · \w{3} \d{4}$/, /^Last 2 months · \w{3}( \d{4})? – \w{3} \d{4}$/, /^Last 3 months · \w{3}( \d{4})? – \w{3} \d{4}$/, 'Whole profile']);
  });

  await step('Enter PIN 12', async () => {
    await drawer.getByLabel('PIN (4–8 digits)').fill('12');
    await drawer.getByRole('button', { name: 'Create link' }).click();
    await expect(drawer.getByText('The PIN is 4 to 8 digits.')).toBeVisible();
    expect(api.calls('POST', /\/share-links$/)).toHaveLength(0);
  });

  await step('Enter 4821, 7 days, last 3 months, and create it', async () => {
    await drawer.getByLabel('PIN (4–8 digits)').fill('4821');
    await drawer.getByRole('radio', { name: /^Last 3 months/ }).check();
    await drawer.getByRole('radio', { name: '7 days' }).check();
    await drawer.getByRole('button', { name: 'Create link' }).click();
    await expect(drawer.getByRole('heading', { name: 'Your link is ready' })).toBeVisible();
    await expect(drawer.locator('[data-scene-art="link-ready"]:not([data-placeholder]) svg')).toBeVisible();
    await expect(drawer.getByLabel('Link', { exact: true })).toHaveValue(/\/share#qaShareToken/);
    await expect(drawer.getByText("Send the PIN separately — we won't show the link or the PIN again.")).toBeVisible();
    expect(api.last('POST', /\/share-links$/)?.body).toEqual({ period: 'LAST_3_MONTHS', expiresInDays: 7, pin: '4821' });
    await expect.poll(() => analytics.events().some((e) => e.event === 'share_link_created'), { timeout: 15_000 }).toBe(true);
    const event = analytics.events().find((e) => e.event === 'share_link_created')!;
    expect(event.properties).toMatchObject({ period: 'last_3_months', expires_in_days: 7 });
    expect(JSON.stringify(event)).not.toMatch(/4821|qaShareToken|Studio/);
  });

  await step('Copy link', async () => {
    await drawer.getByRole('button', { name: 'Copy link' }).click();
    await expect(drawer.getByRole('status')).toHaveText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/share#qaShareToken/);
  });

  await step('Copy message: the link and the date, never the PIN', async () => {
    await drawer.getByRole('button', { name: 'Copy message' }).click();
    const message = await page.evaluate(() => navigator.clipboard.readText());
    expect(message).toMatch(/^Hi, I've shared the books of “Studio” for \w{3}( \d{4})? – \w{3} \d{4} with you on MTB3A: http\S+\/share#qaShareToken\S+ — the link works until \w{3} \d{1,2}\. I'll send you the PIN separately\.$/);
    expect(message).not.toContain('4821');
  });

  await step('Done, reload: the URL appears nowhere, and the list shows the link 0 / 3', async () => {
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/newLink/);
    await page.reload();
    await expect(linkRow(page, /Aug|Sep|Oct|Nov|Jul|Jun/).first()).toContainText('0 / 3');
    expect(await page.content()).not.toContain('qaShareToken');
  });
});

test('link rows show each state, and a live link can be turned off', { tag: '@portal.sharing.link-rows' }, async ({ page, step }) => {
  const api = seeded([SAMI], [LIVE, LOCKED, ENDED]);

  await step('Open Sharing with a live, a locked and an ended link', async () => {
    await openSharing(page, api);
    const live = linkRow(page, 'Aug – Oct 2026');
    await expect(live).toContainText('2 / 3');
    await expect(live).toContainText('yesterday');
    await expect(live.getByRole('button', { name: 'Turn off the link for Aug – Oct 2026' })).toBeVisible();
    const locked = linkRow(page, 'Whole profile');
    await expect(locked).toContainText('Locked');
    await expect(locked).toContainText('—');
    await expect(locked.getByRole('button', { name: /Turn off/ })).toBeVisible();
    const ended = linkRow(page, 'Sep 2026');
    await expect(ended).toContainText(/Ended \w{3} \d{1,2}/);
    await expect(ended.getByRole('button')).toHaveCount(0);
    await expect(page.getByText(/A link is never shown twice/)).toBeVisible();
  });

  await step('Turn off the live link', async () => {
    await linkRow(page, 'Aug – Oct 2026').getByRole('button', { name: 'Turn off the link for Aug – Oct 2026' }).click();
    const confirm = page.getByRole('group', { name: 'Turn off the link for Aug – Oct 2026? Anyone using it is cut off at once.' });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Turn off link' }).click();
    await expect(page.getByText('Link turned off')).toBeVisible();
    await expect(linkRow(page, 'Aug – Oct 2026')).toContainText(/Ended \w{3} \d{1,2}/);
    await expect(linkRow(page, 'Aug – Oct 2026').getByRole('button')).toHaveCount(0);
    expect(api.calls('DELETE', new RegExp(`/share-links/${LIVE.id}$`))).toHaveLength(1);
  });
});

test("the owner downloads a period's receipts from the bottom of the Sharing page", { tag: '@portal.sharing.download-period' }, async ({ page, step, analytics }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Personal'), studio()], accountants: { [OFFICE_B]: [SAMI] }, periodDownloads: true });
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Download a period' }) });

  await step('With usage counts on, open Sharing: Download a period is at the bottom', async () => {
    await actAsPerson(page);
    await api.open(page, `/p/${OFFICE_B}/payments`);
    await page.getByRole('region', { name: 'Share anonymous usage?' }).getByRole('button', { name: 'Share anonymous usage' }).click();
    await expect.poll(() => analytics.events().some((e) => e.event === 'analytics_opted_in'), { timeout: 15_000 }).toBe(true);
    await page.goto(sharingPath);
    await expect(section).toBeVisible();
    await expect(section.getByLabel('From').locator('option')).toHaveCount(24);
  });

  await step('Pick two months and press Receipts (zip): the size before anything downloads', async () => {
    const months = await section.getByLabel('From').locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    await section.getByLabel('From').selectOption(months[2]);
    await section.getByLabel('To').selectOption(months[1]);
    await section.getByRole('button', { name: 'Receipts (zip)' }).click();
    await expect(section.getByRole('status')).toContainText('29 · about 12.3 MB');
    const asked = api.last('GET', /\/v1\/period-downloads\/ticket$/);
    expect(asked?.query.get('type')).toBe('receipts');
    expect(asked?.query.get('from')).toBe(months[2]);
    expect(asked?.query.get('to')).toBe(months[1]);
  });

  await step('Download: the browser saves the zip, and only the place, file and months are counted', async () => {
    const download = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Download', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('mtb3a-receipts.zip');
    await expect(section.getByText('Your download has started.')).toBeVisible();
    expect(api.last('POST', /\/v1\/period-downloads\/stream$/)?.body).toMatchObject({ ticket: expect.stringMatching(/^qa-ticket-receipts/) });
    await expect.poll(() => analytics.events().some((e) => e.event === 'period_downloaded'), { timeout: 15_000 }).toBe(true);
    const event = analytics.events().find((e) => e.event === 'period_downloaded')!;
    expect(event.properties).toMatchObject({ place: 'owner', file: 'receipts', months: 2 });
    expect(JSON.stringify(event.properties)).not.toMatch(/22222222|Studio|qa-ticket|"from"|"to"/);
  });
});

