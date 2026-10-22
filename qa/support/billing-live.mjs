#!/usr/bin/env node
/**
 * MUT-362 (eng review D8 B): the `portal-live` QA app. Settings › Billing against a real dev API and Stripe's real
 * hosted pages in the Mutaba3a sandbox, so release-QA can pay with a test card and cancel in the Customer Portal.
 *
 *   1. the sandbox key from the Keychain (service release-kit, account barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY);
 *      a test key only, never printed, never written to disk;
 *   2. a QA database on the test Postgres (`mutaba3a-test-pg`), migrated;
 *   3. the sandbox catalog: the Freelancer product (metadata tier=freelancer) and the four GA test prices by lookup
 *      key; the Customer Portal's default configuration must already exist (pilot-runbook §1.7 step 3a);
 *   4. `stripe listen` forwarding to the API (the Stripe CLI's own sandbox login), for the webhook secret;
 *   5. the API on 127.0.0.1:8790 and the portal (`vite --mode hosted`) on 127.0.0.1:5176, proxying /v1 to it.
 *
 * It writes qa/.state/portal-live.json (origins and the QA admin token, no Stripe key) for the specs, and stops
 * everything it started on SIGINT/SIGTERM. Ports 8787-8789 belong to other sessions' dev APIs.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_PORT = 8790;
export const PORTAL_PORT = 5176;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const PORTAL_ORIGIN = `http://127.0.0.1:${PORTAL_PORT}`;
const DB_NAME = 'mutaba3a_qa_billing';
const DATABASE_URL = `postgresql://mutaba3a:mutaba3a@localhost:54329/${DB_NAME}`;
// Local QA-only values, not secrets: the API runs on loopback for the length of a QA run.
const ADMIN_TOKEN = 'qa-portal-live-admin-token-0123456789abcdef';
const PEPPER = 'qa-portal-live-session-pepper-0123456789abcdef';
const KEYCHAIN_ACCOUNT = 'barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY';

/** The GA test prices: the founder figures (a year is 10× a month) under the list lookup keys the server reads. */
const PRICES = [
  { lookup_key: 'freelancer_list_monthly_ils', currency: 'ils', unit_amount: 3900, interval: 'month' },
  { lookup_key: 'freelancer_list_yearly_ils', currency: 'ils', unit_amount: 39000, interval: 'year' },
  { lookup_key: 'freelancer_list_monthly_usd', currency: 'usd', unit_amount: 1000, interval: 'month' },
  { lookup_key: 'freelancer_list_yearly_usd', currency: 'usd', unit_amount: 10000, interval: 'year' },
];
const PRODUCT_ID = 'mutaba3a_qa_freelancer';
/** HANDLED_EVENT_TYPES in server/src/billing/stripe/sync.ts. */
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.updated',
];

export function sandboxKey() {
  let key;
  try {
    key = execFileSync('security', ['find-generic-password', '-s', 'release-kit', '-a', KEYCHAIN_ACCOUNT, '-w'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`No Stripe sandbox key in the Keychain (service release-kit, account ${KEYCHAIN_ACCOUNT}). Basel adds it; see .claude/designs/mut-362-self-service-billing.md §6.`);
  }
  if (!/^(sk|rk)_test_/.test(key)) throw new Error('The Keychain entry is not a Stripe test key (sk_test_ or rk_test_); QA never runs on a live key.');
  return key;
}

async function stripe(key, method, endpoint, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = `https://api.stripe.com/v1/${endpoint}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    ...(method === 'GET' ? {} : { body }),
  });
  const json = await res.json();
  if (!res.ok && res.status !== 404) throw new Error(`Stripe ${method} /v1/${endpoint}: ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`);
  return { status: res.status, json };
}

async function ensureCatalog(key) {
  const product = await stripe(key, 'GET', `products/${PRODUCT_ID}`);
  if (product.status === 404) {
    await stripe(key, 'POST', 'products', { id: PRODUCT_ID, name: 'Freelancer (QA)', 'metadata[tier]': 'freelancer' });
  }
  const query = new URLSearchParams({ active: 'true', limit: '10' });
  for (const p of PRICES) query.append('lookup_keys[]', p.lookup_key);
  const listed = await fetch(`https://api.stripe.com/v1/prices?${query}`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
  const have = new Set((listed.data ?? []).map((p) => p.lookup_key));
  for (const p of PRICES.filter((x) => !have.has(x.lookup_key))) {
    await stripe(key, 'POST', 'prices', { product: PRODUCT_ID, currency: p.currency, unit_amount: String(p.unit_amount), 'recurring[interval]': p.interval, lookup_key: p.lookup_key });
  }
  const portal = await stripe(key, 'GET', 'billing_portal/configurations', { is_default: 'true', limit: '1' });
  if (!portal.json.data?.length) {
    throw new Error('The sandbox has no default Customer Portal configuration: save Settings › Billing › Customer portal once in the sandbox dashboard (pilot-runbook §1.7 step 3a).');
  }
}

function ensureDatabase() {
  try {
    execFileSync('docker', ['exec', 'mutaba3a-test-pg', 'createdb', '-U', 'mutaba3a', DB_NAME], { stdio: 'ignore' });
  } catch {
    // Already there: migrate deploy below brings it up to date.
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, DATABASE_URL }, stdio: 'inherit' });
}

function webhookSecret() {
  const secret = execFileSync('stripe', ['listen', '--print-secret'], { encoding: 'utf8' }).trim();
  if (!/^whsec_/.test(secret)) throw new Error('`stripe listen --print-secret` gave no signing secret: log the Stripe CLI in to the Mutaba3a sandbox (stripe login).');
  return secret;
}

async function main() {
  const key = sandboxKey();
  ensureDatabase();
  await ensureCatalog(key);
  const whsec = webhookSecret();

  const children = [];
  const run = (cmd, args, options) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...options });
    children.push(child);
    child.on('exit', (code) => {
      if (!stopping) {
        console.error(`[portal-live] ${cmd} ${args[0]} exited (${code}); stopping the env`);
        stop(1);
      }
    });
    return child;
  };
  let stopping = false;
  const stop = (code = 0) => {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    setTimeout(() => process.exit(code), 500).unref();
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());

  run('stripe', ['listen', '--forward-to', `${API_ORIGIN}/v1/billing/stripe/webhook`, '--events', EVENTS.join(',')]);
  run('npm', ['--prefix', 'server', 'run', 'dev'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL,
      MUTABA3A_ADMIN_TOKEN: ADMIN_TOKEN,
      API_KEY_ENVIRONMENT: 'test',
      SESSION_TOKEN_PEPPER: PEPPER,
      PORTAL_ORIGIN,
      STRIPE_SECRET_KEY: key,
      STRIPE_WEBHOOK_SECRET: whsec,
    },
  });
  run('npm', ['run', 'dev:hosted', '--', '--port', String(PORTAL_PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, MUTABA3A_API_ORIGIN: API_ORIGIN, MUTABA3A_POSTHOG_KEY: 'phc_releaseQaDummyKeyNeverSent000000' },
  });

  mkdirSync(path.join(ROOT, 'qa', '.state'), { recursive: true });
  writeFileSync(path.join(ROOT, 'qa', '.state', 'portal-live.json'), JSON.stringify({ apiOrigin: API_ORIGIN, portalOrigin: PORTAL_ORIGIN, adminToken: ADMIN_TOKEN }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[portal-live] ${err.message}`);
    process.exit(1);
  });
}
