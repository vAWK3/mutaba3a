import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { CURRENT_TERMS } from '../../server/src/legal';

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

/** An operator-created account (the pilot path): its setup link is NOT redeemed unless `password` is given. */
export async function operatorAccount(email: string, locale: 'en' | 'ar', password?: string): Promise<{ id: string; setupUrl: string }> {
  const { origin } = liveState();
  const res = await fetch(`${origin}/admin/v1/users`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ email, displayName: 'Nour Haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale }),
  });
  expect(res.status, `create user ${await res.clone().text()}`).toBe(201);
  const created = (await res.json()) as { user: { id: string }; setupLink: { url: string } };
  if (password) {
    const token = new URL(created.setupLink.url).hash.slice(1);
    const set = await fetch(`${origin}/v1/account-setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ token, password, acceptedTermsVersion: CURRENT_TERMS.version }),
    });
    expect(set.ok, `set password ${set.status}`).toBe(true);
  }
  return { id: created.user.id, setupUrl: created.setupLink.url };
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
