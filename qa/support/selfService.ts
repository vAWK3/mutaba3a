import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { CURRENT_TERMS } from '../../server/src/legal';
import { stepOf, totpAt } from '../../server/src/auth/totp';

/**
 * MUT-368 (D11): helpers for the `portal-selfservice` specs. The env is started by support/selfservice-live.mjs:
 * the API serves the built portal on one origin, mails into its memory outbox, and judges domains from the fixture
 * table. These read the outbox, make operator accounts, decide reviews and age a link, all through the API's own
 * admin routes (and, for the age, the QA database).
 */

interface LiveState {
  origin: string;
  adminToken: string;
  database: string;
  container: string;
  /** MUT-460: OPERATOR_ALERT_EMAIL, the digest's address. */
  operatorDigest: string;
  /** MUT-441: the receipt-ocr sidecar runs and the API reads receipts on it (false without Tesseract on PATH). */
  ocr?: boolean;
}

export interface Mail {
  to: string;
  template: string;
  locale: 'en' | 'ar';
  subject: string;
  text: string;
  html: string;
}

const STATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.state', 'portal-selfservice.json');

export function liveState(): LiveState {
  return JSON.parse(fs.readFileSync(STATE, 'utf8')) as LiveState;
}

const admin = () => ({ 'x-admin-token': liveState().adminToken, 'content-type': 'application/json' });

/** A fresh address on `domain`, unique to this run (the fixture judges the domain, never the local part). */
export function address(label: string, domain = 'business.example'): string {
  return `qa-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@${domain}`;
}

export async function outbox(to: string): Promise<Mail[]> {
  const res = await fetch(`${liveState().origin}/admin/v1/dev-outbox?to=${encodeURIComponent(to)}`, { headers: admin() });
  expect(res.ok, `dev outbox ${res.status}`).toBe(true);
  return ((await res.json()) as { mails: Mail[] }).mails;
}

/** The newest mail to `to` from `template`, waiting a little for it (mail is sent inside the request). */
export async function mailTo(to: string, template: string): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(async () => {
      found = (await outbox(to)).filter((m) => m.template === template).at(-1);
      return found?.template;
    }, { message: `a ${template} mail to ${to}`, timeout: 15_000 })
    .toBe(template);
  return found!;
}

/** The /setup#<token> link in a mail, as the person would click it, on the QA origin. */
export function setupLinkIn(mail: Mail): string {
  const link = mail.text.match(/https?:\/\/[^\s]+\/setup#[A-Za-z0-9_-]{43}/)?.[0];
  expect(link, `a setup link in the ${mail.template} mail`).toBeTruthy();
  return link!;
}

/**
 * An operator-created account (the pilot path): its setup link is NOT redeemed unless `password` is given.
 * MUT-527: `displayName` names the person (the account list's search matches it).
 */
export async function operatorAccount(email: string, locale: 'en' | 'ar', password?: string, displayName = 'Nour Haddad'): Promise<{ id: string; setupUrl: string }> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/admin/v1/users`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ email, displayName, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale }),
  });
  expect(res.status, `create user ${await res.clone().text()}`).toBe(201);
  const created = (await res.json()) as { user: { id: string }; setupLink: { url: string } };
  if (password) await redeemSetupLink(created.setupLink.url, password);
  return { id: created.user.id, setupUrl: created.setupLink.url };
}

const rand255 = () => Math.floor(Math.random() * 254);

/** Sets a password through a /setup#<token> link, as the setup page does. */
export async function redeemSetupLink(url: string, password: string): Promise<void> {
  const { origin } = liveState();
  const token = new URL(url).hash.slice(1);
  const set = await fetch(`${origin}/v1/account-setup`, {
    method: 'POST',
    // Its own client address (the QA API trusts one proxy hop), so a long run's many setups never share one IP's budget.
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': `10.${rand255()}.${rand255()}.${rand255() + 1}` },
    body: JSON.stringify({ token, password, acceptedTermsVersion: CURRENT_TERMS.version }),
  });
  expect(set.ok, `set password ${set.status}`).toBe(true);
}

/** MUT-433/434: the operator turns a per-user feature on (agent_access lets the person connect an agent). */
export async function grantFeature(userId: string, feature = 'agent_access'): Promise<void> {
  const res = await fetch(`${liveState().origin}/admin/v1/users/${userId}/features/${feature}`, { method: 'PUT', headers: admin() });
  expect(res.status, `grant ${feature} ${await res.clone().text()}`).toBe(200);
}

/** MUT-358: the operator comps a person's own profiles (a pilot grant), so their writes pass the lapse gate (ADR-181). */
export async function grantCoverage(userId: string): Promise<void> {
  const res = await fetch(`${liveState().origin}/admin/v1/billing/grants`, {
    method: 'POST',
    headers: { ...admin(), 'content-type': 'application/json' },
    body: JSON.stringify({ userId, tier: 'FREELANCER', reason: 'release-QA pilot comp' }),
  });
  expect(res.status, `grant coverage ${await res.clone().text()}`).toBe(201);
}

/** The operator approves or declines the waiting signup for `email` (/admin/v1/signup-reviews). */
export async function decideReview(email: string, decision: 'approve' | 'decline'): Promise<void> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/admin/v1/signup-reviews?state=pending&limit=100`, { headers: admin() });
  const reviews = ((await res.json()) as { data: Array<{ userId: string | null; email: string | null }> }).data;
  const review = reviews.find((r) => r.email === email);
  expect(review?.userId, `a pending review for ${email}`).toBeTruthy();
  const decided = await fetch(`${origin}/admin/v1/signup-reviews/${review!.userId}/${decision}`, { method: 'POST', headers: admin(), body: '{}' });
  expect(decided.status, `${decision} ${await decided.clone().text()}`).toBe(200);
}

/** MUT-460: a random client address per request, so the API's per-IP budgets (one trusted proxy hop) never add up. */
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 254) + 1).join('.')}`;
export const SIGNUP_PASSWORD = 'a waiting signup passphrase';

/**
 * MUT-460: a signup waiting for the operator, made as /signup and /setup make one (Turnstile's always-pass test secret
 * on this dev API): an @gmail.com address is webmail, so it waits for review. Returns the address.
 */
export async function pendingSignup(label: string): Promise<string> {
  const { origin } = liveState();
  const email = address(label, 'gmail.com');
  const asked = await fetch(`${origin}/v1/signups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': randomIp() },
    body: JSON.stringify({ email, locale: 'en', turnstileToken: 'qa-turnstile-test-token' }),
  });
  expect(asked.status, `signup ${await asked.clone().text()}`).toBe(202);
  const token = new URL(setupLinkIn(await mailTo(email, 'finish-signup'))).hash.slice(1);
  const set = await fetch(`${origin}/v1/account-setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': randomIp() },
    body: JSON.stringify({ token, password: SIGNUP_PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }),
  });
  expect(set.ok, `finish signup ${set.status}`).toBe(true);
  // MUT-737: with open sign-up (the QA API runs OPEN_SIGNUP) the account opens at once; there is no review queue.
  expect(((await set.json()) as { status: string }).status).toBe('ACTIVE');
  return email;
}

/** MUT-460: makes a person an operator (MUT-459). The admin route refuses one with no passkey, so add one first. */
export async function grantOperator(userId: string): Promise<void> {
  const res = await fetch(`${liveState().origin}/admin/v1/users/${userId}/operator`, { method: 'PUT', headers: admin() });
  expect(res.status, `grant operator ${await res.clone().text()}`).toBe(200);
}

/** MUT-460: whether `email` can sign in with `password` now (an approved signup can; one under review or gone can't). */
export async function signsIn(email: string, password: string): Promise<boolean> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': randomIp() },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

/** MUT-461: a portal session for `email`, as another of their devices holds one: its cookie, for `sessionWorks`. */
export async function liveSession(email: string, password: string): Promise<string> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': randomIp() },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `sign in ${email}`).toBe(201);
  const cookie = /mut_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0];
  expect(cookie, 'a session cookie').toBeTruthy();
  return cookie!;
}

/**
 * MUT-462: a person who owns a Business profile and has asked for firm features on it, as the portal's profile page
 * asks (MUT-300). Only a profile's owner can ask, so this is the request the live console sees. Returns the profile.
 */
export async function ownedFirmRequest(label: string, password: string): Promise<{ email: string; userId: string; profileId: string; profileName: string }> {
  const { origin } = liveState();
  const email = address(label);
  const { id: userId } = await operatorAccount(email, 'en', password);
  // Owned profiles write through the lapse gate (ADR-181): comp the person first, as a pilot would be.
  await grantCoverage(userId);
  const cookie = await liveSession(email, password);
  const profileName = `QA Firm ${Date.now().toString(36)}`;
  const headers = (key: string) => ({ 'content-type': 'application/json', origin, cookie, 'idempotency-key': `${key}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });
  const made = await fetch(`${origin}/v1/profiles`, {
    method: 'POST',
    headers: headers('qa-profile'),
    body: JSON.stringify({ name: profileName, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }),
  });
  expect(made.status, `create profile ${await made.clone().text()}`).toBe(201);
  const profileId = ((await made.json()) as { id: string }).id;
  const asked = await fetch(`${origin}/v1/profiles/${profileId}/firm-request`, { method: 'POST', headers: headers('qa-firm'), body: '{}' });
  expect(asked.ok, `firm request ${await asked.clone().text()}`).toBe(true);
  return { email, userId, profileId, profileName };
}

/**
 * MUT-462: an operator-made firm with two members, one of whom has asked for firm features: the request whose owners the
 * operator chooses. The product only lets an owner ask on a profile they own, so the request is marked in the QA
 * database (as `expireSignupLinks` ages a link), the way MUT-300's pre-portal requests were recorded.
 */
export async function operatorFirmRequest(label: string): Promise<{ organizationId: string; name: string; requester: { id: string; email: string }; other: { id: string; email: string } }> {
  const { origin, container, database } = liveState();
  const name = `QA Operator Firm ${Date.now().toString(36)}`;
  const made = await fetch(`${origin}/admin/v1/organizations`, { method: 'POST', headers: admin(), body: JSON.stringify({ name, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }) });
  expect(made.status, `create firm ${await made.clone().text()}`).toBe(201);
  const organizationId = ((await made.json()) as { id: string }).id;
  const members: Array<{ id: string; email: string }> = [];
  for (const who of ['requester', 'colleague']) {
    const email = address(`${label}-${who}`);
    const res = await fetch(`${origin}/admin/v1/users`, { method: 'POST', headers: admin(), body: JSON.stringify({ email, displayName: who === 'requester' ? 'Rana Saleh' : 'Omar Haddad', organizationId, locale: 'en' }) });
    expect(res.status, `create member ${await res.clone().text()}`).toBe(201);
    members.push({ id: ((await res.json()) as { user: { id: string } }).user.id, email });
  }
  const sql = `UPDATE organizations SET "firmRequestedAt" = now(), "firmRequestedByUserId" = '${members[0]!.id}' WHERE id = '${organizationId}'`;
  execFileSync('docker', ['exec', container, 'psql', '-U', 'mutaba3a', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
  return { organizationId, name, requester: members[0]!, other: members[1]! };
}

/** MUT-462: a member's role on a profile, as the admin token reads the organization. */
export async function memberRole(organizationId: string, userId: string): Promise<string | undefined> {
  const res = await fetch(`${liveState().origin}/admin/v1/organizations/${organizationId}`, { headers: admin() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { members: Array<{ userId: string; role: string }> }).members.find((m) => m.userId === userId)?.role;
}

/** MUT-462: what the admin token reads of a profile (its firm state) and its audit trail, newest first. */
export async function adminOrganization(organizationId: string): Promise<{ firm: { enabledAt: string | null; requestedAt: string | null }; ownerUserId: string | null }> {
  const res = await fetch(`${liveState().origin}/admin/v1/organizations/${organizationId}`, { headers: admin() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { organization: { firm: { enabledAt: string | null; requestedAt: string | null }; ownerUserId: string | null } }).organization;
}

export async function adminAudit(organizationId: string): Promise<Array<{ action: string; actorType: string; actorId: string | null }>> {
  const res = await fetch(`${liveState().origin}/admin/v1/organizations/${organizationId}/audit?limit=200`, { headers: admin() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { events: Array<{ action: string; actorType: string; actorId: string | null }> }).events;
}

/** MUT-462: a person's grants, and whether a feature is on for them, as the admin token reads them (the CLI's view). */
export async function adminGrants(userId: string): Promise<Array<{ id: string; reason: string; grantedBy: string; revokedAt: string | null; tier: string }>> {
  const res = await fetch(`${liveState().origin}/admin/v1/billing/grants?userId=${userId}`, { headers: admin() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { grants: Array<{ id: string; reason: string; grantedBy: string; revokedAt: string | null; tier: string }> }).grants;
}

export async function featureHolders(feature = 'agent_access'): Promise<string[]> {
  const res = await fetch(`${liveState().origin}/admin/v1/features/${feature}`, { headers: admin() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { holders: Array<{ userId: string }> }).holders.map((h) => h.userId);
}

/** MUT-461: whether a session from `liveSession` still works (a sign out everywhere or a disable ends it). */
export async function sessionWorks(cookie: string): Promise<boolean> {
  return (await fetch(`${liveState().origin}/v1/me`, { headers: { cookie } })).ok;
}

/** Age every open SIGNUP link for `email` past its 24 h, in the QA database (D12): no waiting, no clock route. */
export function expireSignupLinks(email: string): void {
  const { container, database } = liveState();
  const sql = `UPDATE account_setup_tokens SET "expiresAt" = now() - interval '1 minute' WHERE email = '${email.replace(/'/g, "''")}' AND purpose = 'SIGNUP'`;
  execFileSync('docker', ['exec', container, 'psql', '-U', 'mutaba3a', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
}

/**
 * MUT-370: "30 days later" for the passkey suggestion. Moves the hide that Not now set into the past for `email`, in
 * the QA database (no clock route), so the next offer is due.
 */
export function lapsePasskeyPromptHide(email: string): void {
  const { container, database } = liveState();
  const past = `to_jsonb(to_char((now() - interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`;
  const sql = `UPDATE users SET "passkeyPrompt" = jsonb_set("passkeyPrompt", '{hiddenUntil}', ${past}) WHERE email = '${email.replace(/'/g, "''")}' AND "passkeyPrompt" IS NOT NULL`;
  execFileSync('docker', ['exec', container, 'psql', '-U', 'mutaba3a', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
}

/** Sign a page's browser in through the portal's own form. */
export async function signInThroughForm(page: Page, email: string, password: string, language: 'en' | 'ar' = 'en'): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel(language === 'ar' ? 'البريد الإلكتروني' : 'Email').fill(email);
  await page.getByLabel(language === 'ar' ? 'كلمة المرور' : 'Password').fill(password);
  await page.getByRole('button', { name: language === 'ar' ? 'تسجيل الدخول' : 'Sign in', exact: true }).click();
}

/** Choose the page language before the app reads it (the portal's own key; Arabic is the default, ADR-077). */
export async function chooseLanguage(page: Page, language: 'en' | 'ar'): Promise<void> {
  await page.addInitScript((lang) => localStorage.setItem('mutaba3a-portal-language', lang), language);
}

/** MUT-619's setup step, in each language: shown after /setup sets a password on a device that can make a passkey. */
export const SETUP_PASSKEY = {
  en: { title: 'Create a passkey', create: 'Create a passkey', notNow: 'Not now' },
  ar: { title: 'أنشئ مفتاح مرور', create: 'أنشئ مفتاح مرور', notNow: 'ليس الآن' },
} as const;

/**
 * MUT-619: this app's portal can make passkeys (WEBAUTHN_RP_ID=localhost), so setting a password on /setup now ends on
 * the passkey step. Flows about something else answer it with Not now, as most people who skip it would.
 */
export async function skipSetupPasskey(page: Page, language: 'en' | 'ar' = 'en'): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: SETUP_PASSKEY[language].title })).toBeVisible();
  await page.getByRole('button', { name: SETUP_PASSKEY[language].notNow }).click();
}

/**
 * MUT-710: turns two-step sign-in on for `email`, through the API as the You › Account drawer does (sign in, start an
 * enrolment with the current password, confirm with a code). The authenticator method returns its secret, so a spec can
 * compute the app's codes; the email method reads its test code from the outbox. Returns the 10 recovery codes.
 *
 * The confirm uses the current 30 s step, which the server then refuses to accept again (replay): a spec that signs in
 * with the app afterwards types `appCode(secret, 1)`, the next step, which the server's ±1 step window accepts.
 */
export async function enableTwoFactor(email: string, password: string, method: 'totp' | 'email'): Promise<{ secret: string | null; recoveryCodes: string[] }> {
  const { origin } = liveState();
  const cookie = await liveSession(email, password);
  const headers = { 'content-type': 'application/json', origin, cookie, 'x-forwarded-for': randomIp() };
  const started = await fetch(`${origin}/v1/me/two-factor/enrolment`, { method: 'POST', headers, body: JSON.stringify({ method, currentPassword: password }) });
  expect(started.status, `start two-step ${await started.clone().text()}`).toBe(201);
  const enrolment = (await started.json()) as { enrolmentToken: string; secret: string | null };
  const code = method === 'totp' ? appCode(enrolment.secret!, 0) : codeFromMail(await mailTo(email, 'two-factor-code'));
  const confirmed = await fetch(`${origin}/v1/me/two-factor/enrolment/confirm`, { method: 'POST', headers, body: JSON.stringify({ enrolmentToken: enrolment.enrolmentToken, code }) });
  expect(confirmed.status, `confirm two-step ${await confirmed.clone().text()}`).toBe(201);
  return { secret: enrolment.secret, recoveryCodes: ((await confirmed.json()) as { recoveryCodes: string[] }).recoveryCodes };
}

/** The authenticator app's code now (`ahead` = 0) or `ahead` 30-second steps later, from the secret the enrolment shows. */
export function appCode(secret: string, ahead: number): string {
  return totpAt(secret.replace(/\s/g, ''), stepOf(new Date()) + ahead);
}

/** The 6-digit code on its own line in a two-step mail. */
export function codeFromMail(mail: Mail): string {
  const code = mail.text.match(/^\d{6}$/m)?.[0];
  expect(code, `a 6-digit code on its own line in the ${mail.template} mail`).toBeTruthy();
  return code!;
}

/** MUT-702/735: the operator grants a person a plan (an operator grant names the tier), as /admin does. */
export async function grantPlan(userId: string, tier: 'SOLO' | 'BUSINESS' | 'FIRM'): Promise<void> {
  const res = await fetch(`${liveState().origin}/admin/v1/billing/grants`, {
    method: 'POST',
    headers: { ...admin(), 'content-type': 'application/json' },
    body: JSON.stringify({ userId, tier, reason: 'release-QA usage plan' }),
  });
  expect(res.status, `grant ${tier} ${await res.clone().text()}`).toBe(201);
}

/**
 * MUT-759 (pilot, ADR-296): a pilot grant through the admin route, as `billing:grant --cohort` makes it: Business, the
 * cohort, optionally the referring accountant, an expiry (60 days without one) and the tester's yes (MUT-777).
 */
export async function grantPilot(userId: string, options: { cohort?: string; accountantId?: string; expiresAt?: string; watchConsent?: boolean } = {}): Promise<{ id: string; expiresAt: string }> {
  const res = await fetch(`${liveState().origin}/admin/v1/billing/grants`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({
      userId,
      tier: 'BUSINESS',
      reason: 'release-QA pilot',
      cohort: options.cohort ?? 'qa-pilot',
      ...(options.accountantId ? { referredByUserId: options.accountantId } : {}),
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      ...(options.watchConsent ? { watchConsent: true } : {}),
    }),
  });
  expect(res.status, `grant pilot ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as { id: string; expiresAt: string };
}

/** MUT-759: revoke a grant through the admin route (a pilot's end, or the first half of an extension). */
export async function revokeGrant(grantId: string): Promise<void> {
  const res = await fetch(`${liveState().origin}/admin/v1/billing/grants/${grantId}`, { method: 'DELETE', headers: admin() });
  expect(res.status, `revoke ${await res.clone().text()}`).toBe(200);
}

/**
 * MUT-735 (ADR-281): this Jerusalem month's usage for a person, written into the QA database as the meters would have
 * written it (one event per document or scan, then the counters). Real issuing needs a Tax Authority setup and scans a
 * bucket; the live metering of a finished scan is proven by `usage.billing-usage`.
 */
export function seedUsage(userId: string, plan: 'solo' | 'business' | 'firm', counts: { documents: number; scans: number }): void {
  const { container, database } = liveState();
  const month = `to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM')`;
  const events = (kind: string, detail: string, n: number) =>
    n === 0
      ? ''
      : `INSERT INTO usage_events (id, "occurredAt", month, "subjectKey", "actorUserId", "organizationId", kind, detail, plan, door, "entityKey")
         SELECT gen_random_uuid(), now() AT TIME ZONE 'UTC', ${month}, 'user:${userId}', '${userId}', NULL, '${kind}', '${detail}', '${plan}', 'PORTAL', 'qa-' || gen_random_uuid()
         FROM generate_series(1, ${n});`;
  const counter = (meter: string, n: number) =>
    n === 0
      ? ''
      : `INSERT INTO usage_counters ("subjectKey", month, meter, count, plan, "updatedAt") VALUES ('user:${userId}', ${month}, '${meter}', ${n}, '${plan}', now() AT TIME ZONE 'UTC')
         ON CONFLICT ("subjectKey", month, meter) DO UPDATE SET count = usage_counters.count + EXCLUDED.count, plan = EXCLUDED.plan;`;
  const sql = [events('DOCUMENT_ISSUED', 'TAX_INVOICE', counts.documents), counter('DOCUMENTS', counts.documents), events('SCAN', 'LIBRARY', counts.scans), counter('SCANS', counts.scans)].join('\n');
  execFileSync('docker', ['exec', container, 'psql', '-U', 'mutaba3a', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
}
