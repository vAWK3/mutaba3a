#!/usr/bin/env node
/**
 * MUT-362 (eng review D8 B): the `portal-live` QA app. Settings › Billing against a real dev API and Stripe's real
 * hosted pages in the Mutaba3a sandbox, so release-QA can pay with a test card and cancel in the Customer Portal.
 *
 *   1. the sandbox key from the Keychain (service release-kit, account barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY);
 *      a test key only, never printed, never written to disk;
 *   2. a QA database on the test Postgres (`mutaba3a-test-pg`), migrated;
 *   3. the sandbox catalog: the Freelancer product (metadata tier=freelancer) and the four GA list prices by lookup
 *      key (₪49 / ₪490 / $16 / $160, MUT-418), VAT-exclusive; a key on another amount moves by lookup-key transfer;
 *      the Customer Portal's default configuration must already exist (pilot-runbook §1.7 step 3a);
 *   4. `stripe listen` forwarding to the API, for the webhook secret; the CLI gets the same sandbox key through
 *      STRIPE_API_KEY (never argv), so its own `stripe login`, which expires, is not needed;
 *   5. the API on 127.0.0.1:8790 and the portal (`vite --mode hosted`) on 127.0.0.1:5176, proxying /v1 to it.
 *
 * It writes qa/.state/portal-live.json (origins and the QA admin token, no Stripe key) for the specs, and stops
 * everything it started on SIGINT/SIGTERM. Ports 8787-8789 belong to other sessions' dev APIs.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPortFree } from './port-check.mjs';

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

/**
 * The GA list prices (Basel, 2026-10-23, MUT-418): ₪49 / $16 a month, a year 10× a month, VAT-exclusive, under the
 * list lookup keys the server reads. MUT-362 first made them at ₪39 / $10; `ensureCatalog` moves each key to a price
 * at these amounts with Stripe's lookup-key transfer (the old prices stay, keyless, for subscriptions already on them).
 */
export const PRICES = [
  { lookup_key: 'freelancer_list_monthly_ils', currency: 'ils', unit_amount: 4900, interval: 'month' },
  { lookup_key: 'freelancer_list_yearly_ils', currency: 'ils', unit_amount: 49000, interval: 'year' },
  { lookup_key: 'freelancer_list_monthly_usd', currency: 'usd', unit_amount: 1600, interval: 'month' },
  { lookup_key: 'freelancer_list_yearly_usd', currency: 'usd', unit_amount: 16000, interval: 'year' },
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

/** A price already under its key is right only at the wanted amount, currency, interval and product, VAT-exclusive. */
export function priceMatches(listed, wanted, productId = PRODUCT_ID) {
  const product = typeof listed.product === 'string' ? listed.product : listed.product?.id;
  return (
    listed.unit_amount === wanted.unit_amount &&
    listed.currency === wanted.currency &&
    listed.recurring?.interval === wanted.interval &&
    listed.tax_behavior === 'exclusive' &&
    product === productId
  );
}

export async function ensureCatalog(key) {
  const product = await stripe(key, 'GET', `products/${PRODUCT_ID}`);
  if (product.status === 404) {
    await stripe(key, 'POST', 'products', { id: PRODUCT_ID, name: 'Freelancer (QA)', 'metadata[tier]': 'freelancer' });
  }
  const query = new URLSearchParams({ active: 'true', limit: '10' });
  for (const p of PRICES) query.append('lookup_keys[]', p.lookup_key);
  const listed = await fetch(`https://api.stripe.com/v1/prices?${query}`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
  const byKey = new Map((listed.data ?? []).map((p) => [p.lookup_key, p]));
  for (const wanted of PRICES) {
    const current = byKey.get(wanted.lookup_key);
    if (current && priceMatches(current, wanted)) continue;
    // Missing, or at another amount (MUT-362's ₪39 / $10): a new price takes the key over (MUT-418, D12).
    const made = await stripe(key, 'POST', 'prices', {
      product: PRODUCT_ID,
      currency: wanted.currency,
      unit_amount: String(wanted.unit_amount),
      'recurring[interval]': wanted.interval,
      lookup_key: wanted.lookup_key,
      transfer_lookup_key: 'true',
      tax_behavior: 'exclusive',
    });
    console.log(`[portal-live] ${wanted.lookup_key} → ${made.json.id} (${wanted.unit_amount} ${wanted.currency}${current ? `, was ${current.id} at ${current.unit_amount}` : ''})`);
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

/** A shell that exports APPLE_TEAM_ID for fastlane would half-set the API's app association, which it refuses. */
const APP_ASSOCIATION_VARS = ['APPLE_TEAM_ID', 'APPLE_BUNDLE_ID', 'ANDROID_PACKAGE_NAME', 'ANDROID_SHA256_FINGERPRINTS'];
const withoutAppAssociation = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !APP_ASSOCIATION_VARS.includes(name)));

/** The Stripe CLI's environment: the sandbox key in STRIPE_API_KEY, which the CLI prefers to its saved login. */
const stripeCliEnv = (key) => ({ ...process.env, STRIPE_API_KEY: key });

function webhookSecret(key) {
  const secret = execFileSync('stripe', ['listen', '--print-secret'], { encoding: 'utf8', env: stripeCliEnv(key) }).trim();
  if (!/^whsec_/.test(secret)) throw new Error('`stripe listen --print-secret` gave no signing secret for the sandbox key.');
  return secret;
}

/** `node qa/support/billing-live.mjs --catalog-only`: set the sandbox catalog and stop (MUT-418's one-time price move). */
const CATALOG_ONLY = process.argv.includes('--catalog-only');

async function main() {
  const key = sandboxKey();
  if (CATALOG_ONLY) {
    await ensureCatalog(key);
    return;
  }
  await assertPortFree(API_PORT, 'portal-live');
  ensureDatabase();
  await ensureCatalog(key);
  const whsec = webhookSecret(key);

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

  run('stripe', ['listen', '--forward-to', `${API_ORIGIN}/v1/billing/stripe/webhook`, '--events', EVENTS.join(',')], { env: stripeCliEnv(key) });
  run('npm', ['--prefix', 'server', 'run', 'dev'], {
    cwd: ROOT,
    env: {
      ...withoutAppAssociation(process.env),
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      // MUT-463: loopback only, so the committed admin token can't be used from the network.
      HOST: '127.0.0.1',
      DATABASE_URL,
      MUTABA3A_ADMIN_TOKEN: ADMIN_TOKEN,
      API_KEY_ENVIRONMENT: 'test',
      SESSION_TOKEN_PEPPER: PEPPER,
      PORTAL_ORIGIN,
      STRIPE_SECRET_KEY: key,
      STRIPE_WEBHOOK_SECRET: whsec,
      // MUT-418: the trial flows start at a real signup: the memory mailer (read through GET /admin/v1/dev-outbox), the
      // fixture domain checker (business.example opens at once) and the always-pass Turnstile test secret
      // (config.ts's development default). Each spec sends its own X-Forwarded-For, so the per-IP budget never adds up.
      MAILER: 'memory',
      SELF_SIGNUP_ENABLED: 'true',
      EMAIL_DOMAIN_CHECKER: 'fixture',
      TRUSTED_PROXY_HOPS: '1',
      SIGNUP_RESPONSE_FLOOR_MS: '100',
      RECOVERY_RESPONSE_FLOOR_MS: '100',
    },
  });
  // Its own Vite cache (support/qa.vite.ts, MUT-440): the portal app's server runs at the same time
  run('npx', ['vite', '--config', 'qa/support/qa.vite.ts', '--mode', 'hosted', '--port', String(PORTAL_PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, QA_VITE_ROLE: 'portal-live', MUTABA3A_API_ORIGIN: API_ORIGIN, MUTABA3A_POSTHOG_KEY: 'phc_releaseQaDummyKeyNeverSent000000' },
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
