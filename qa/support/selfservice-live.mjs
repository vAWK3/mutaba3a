#!/usr/bin/env node
/**
 * MUT-368 (D11): the `portal-selfservice` QA app. Signup, recovery and the review queue against a real dev API, with
 * no third-party call: the memory mailer (its outbox read through GET /admin/v1/dev-outbox), the fixture domain
 * checker (business.example, young.example, unverified.example, nomail.example; gmail.com is webmail and
 * mailinator.com disposable), Turnstile's published always-pass test secret, and short response floors.
 *
 *   1. a QA database of its own on the test Postgres (`mutaba3a-test-pg`), named per launch and migrated;
 *   2. the built portal (`vite build --mode hosted`), served by the API itself as production serves it, so the
 *      real PORTAL_CSP applies (review P1-4);
 *   3. the API listening on 127.0.0.1:8791 only (HOST, MUT-463) and reached at http://localhost:8791, which is also
 *      the portal's origin. The origin is `localhost`, not 127.0.0.1: MUT-115's passkey flows need a WebAuthn
 *      relying-party ID, and an IP address can't be one (WEBAUTHN_RP_ID=localhost here).
 *
 * MUT-441: the receipt-ocr sidecar (server/ocr/run_local.sh, no Docker) on 127.0.0.1:8792, and the API reading receipts
 * on it in process (SERVER_OCR, no READ_QUEUE) for people the specs grant `receipt_reading`, with the receipts library
 * on and QA_READ_DELAY_MS standing in for Cloud Tasks' dispatch, so the portal's "Reading…" state can be seen. Without
 * Tesseract on PATH the env still starts, reading off (`ocr: false` in the state file), and receipts.spec.ts says why.
 *
 * Cloudflare's widget script is answered by the specs themselves (support/turnstile.ts), never fetched.
 * It writes qa/.state/portal-selfservice.json (origin, admin token, database name) for the specs, and drops the
 * database and stops the API (and the sidecar) on SIGINT/SIGTERM. Ports 8787-8790 belong to other sessions' dev APIs
 * and portal-live; 8090 to a developer's own sidecar.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPortFree } from './port-check.mjs';

export const API_PORT = 8791;
/** MUT-441: the QA sidecar's port (not run_local.sh's default 8090, which a developer's own sidecar may hold). */
const OCR_PORT = 8792;
const OCR_URL = `http://127.0.0.1:${OCR_PORT}`;
/** Loading RapidOCR's and Tesseract's models takes seconds; a first run also builds the venv. */
const OCR_READY_TIMEOUT_MS = 300_000;
/** MUT-441: how long an in-process read waits (QA_READ_DELAY_MS), long enough to see "Reading…" on the review page. */
const READ_DELAY_MS = 8_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = `http://localhost:${API_PORT}`;
const PG_CONTAINER = 'mutaba3a-test-pg';
const DB_NAME = `mutaba3a_qa_selfservice_${process.pid}`;
const DATABASE_URL = `postgresql://mutaba3a:mutaba3a@localhost:54329/${DB_NAME}`;
const DIST = path.join(ROOT, 'qa', '.state', 'selfservice-dist');
const STATE = path.join(ROOT, 'qa', '.state', 'portal-selfservice.json');
const ATTACHMENTS = path.join(ROOT, 'qa', '.state', 'selfservice-attachments');
// Local QA-only values, not secrets: the API runs on loopback for the length of a QA run.
const ADMIN_TOKEN = 'qa-portal-selfservice-admin-token-0123456789';
const PEPPER = 'qa-portal-selfservice-session-pepper-0123456789';
/** MUT-460: where the operator digest goes (read through the outbox; the state file names it for the specs). */
const OPERATOR_DIGEST_ADDRESS = 'qa-operator-digest@business.example';

/** A shell that exports APPLE_TEAM_ID for fastlane would half-set the API's app association, which it refuses. */
const APP_ASSOCIATION_VARS = ['APPLE_TEAM_ID', 'APPLE_BUNDLE_ID', 'ANDROID_PACKAGE_NAME', 'ANDROID_SHA256_FINGERPRINTS'];
/** Anything mail- or signup-shaped in the operator's shell would change what the QA server does. */
/** MUT-441: the reader is this env's own (an in-process read on the QA sidecar), never a queue or a shell's sidecar. */
const RECEIPT_READING_VARS = ['RECEIPTS_LIBRARY', 'SERVER_OCR', 'OCR_URL', 'READ_QUEUE', 'API_ORIGIN', 'READ_INVOKER_SA', 'SWEEP_INVOKER_SA', 'READ_OIDC_AUDIENCE', 'QA_READ_DELAY_MS'];
const SELF_SERVICE_VARS = ['WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGINS', 'MAILER', 'TURNSTILE_SECRET', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO', 'SELF_SIGNUP_ENABLED', 'EMAIL_DOMAIN_CHECKER', 'OPERATOR_ALERT_EMAIL', 'OAUTH_DERIVE_KEY'];
const cleanEnv = (env) =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !APP_ASSOCIATION_VARS.includes(name) && !SELF_SERVICE_VARS.includes(name) && !RECEIPT_READING_VARS.includes(name)));

function psql(sql) {
  execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', 'mutaba3a', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
}

function createDatabase() {
  try {
    execFileSync('docker', ['exec', PG_CONTAINER, 'pg_isready', '-U', 'mutaba3a'], { stdio: 'ignore' });
  } catch {
    throw new Error(`The test Postgres container ${PG_CONTAINER} isn't running: start Docker and the container (server/README.md, test:db), then retry.`);
  }
  psql(`CREATE DATABASE ${DB_NAME}`);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, DATABASE_URL }, stdio: 'inherit' });
}

function dropDatabase() {
  try {
    psql(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  } catch {
    console.error(`[portal-selfservice] could not drop ${DB_NAME}; drop it by hand`);
  }
}

function buildPortal() {
  rmSync(DIST, { recursive: true, force: true });
  // No PostHog key and no Sentry DSN: nothing leaves the machine. No Turnstile key: Cloudflare's always-pass test key.
  const env = { ...process.env };
  for (const name of ['MUTABA3A_POSTHOG_KEY', 'MUTABA3A_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'MUTABA3A_TURNSTILE_SITE_KEY']) delete env[name];
  // MUT-115: passkeys on this origin (the portal offers them only on a host under its RP ID).
  env.MUTABA3A_PASSKEY_RP_ID = 'localhost';
  execFileSync('npx', ['vite', 'build', '--mode', 'hosted', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });
}

function hasTesseract() {
  try {
    execFileSync('tesseract', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** MUT-441: the receipt-ocr sidecar, once its /healthz says the models are loaded; null when it can't run here. */
async function startOcr() {
  if (!hasTesseract()) {
    console.error('[portal-selfservice] tesseract is not on PATH (macOS: brew install tesseract): receipts are not read in this env');
    return null;
  }
  await assertPortFree(OCR_PORT, 'portal-selfservice receipt-ocr');
  const ocr = spawn('bash', [path.join(ROOT, 'server', 'ocr', 'run_local.sh')], { stdio: 'inherit', env: { ...process.env, PORT: String(OCR_PORT) } });
  const deadline = Date.now() + OCR_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ocr.exitCode !== null) throw new Error(`the receipt-ocr sidecar exited (${ocr.exitCode}) before it was ready`);
    const ok = await fetch(`${OCR_URL}/healthz`).then((r) => r.ok, () => false);
    if (ok) return ocr;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  ocr.kill('SIGTERM');
  throw new Error(`the receipt-ocr sidecar wasn't ready within ${OCR_READY_TIMEOUT_MS / 1000} s`);
}

async function main() {
  await assertPortFree(API_PORT, 'portal-selfservice');
  buildPortal();
  createDatabase();
  const ocr = await startOcr();

  let stopping = false;
  const api = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    stdio: 'inherit',
    env: {
      ...cleanEnv(process.env),
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      // MUT-463: loopback only, so the committed admin token can't be used from the network. The origin stays
      // localhost (the passkey RP ID); browsers and Node fall back from ::1 to 127.0.0.1.
      HOST: '127.0.0.1',
      DATABASE_URL,
      MUTABA3A_ADMIN_TOKEN: ADMIN_TOKEN,
      API_KEY_ENVIRONMENT: 'test',
      SESSION_TOKEN_PEPPER: PEPPER,
      PORTAL_ORIGIN: ORIGIN,
      PORTAL_DIST_DIR: DIST,
      // Every test sends its own X-Forwarded-For (qa.config.mjs clientIpHeader), so the per-IP budgets don't add up.
      TRUSTED_PROXY_HOPS: '1',
      MAILER: 'memory',
      SELF_SIGNUP_ENABLED: 'true',
      EMAIL_DOMAIN_CHECKER: 'fixture',
      SIGNUP_RESPONSE_FLOOR_MS: '100',
      // MUT-460: the operator digest, whose link opens the portal's signups page (operator.spec.ts).
      OPERATOR_ALERT_EMAIL: OPERATOR_DIGEST_ADDRESS,
      RECOVERY_RESPONSE_FLOOR_MS: '100',
      // MUT-115: passkeys, checked by Chromium's virtual authenticator (support/passkeys.ts).
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGINS: ORIGIN,
      // MUT-434: OAuth for MCP agents (connect.spec.ts), with PORTAL_ORIGIN above as the issuer.
      OAUTH_DERIVE_KEY: 'qa-portal-selfservice-oauth-derive-key-0123456789',
      // MUT-436: receipt uploads from an agent (mcp.spec.ts) PUT to the API's own /dev/attachments (MUT-396's local
      // driver, never in production); the folder goes with the env.
      ATTACHMENTS_DRIVER: 'local',
      ATTACHMENTS_DIR: ATTACHMENTS,
      // MUT-441: Expenses › Receipts, and the server reading what's uploaded there (receipts.spec.ts server-reading).
      RECEIPTS_LIBRARY: 'true',
      ...(ocr ? { SERVER_OCR: 'true', OCR_URL, QA_READ_DELAY_MS: String(READ_DELAY_MS) } : {}),
    },
  });
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    api.kill('SIGTERM');
    ocr?.kill('SIGTERM');
    setTimeout(() => {
      dropDatabase();
      rmSync(STATE, { force: true });
      rmSync(ATTACHMENTS, { recursive: true, force: true });
      process.exit(code);
    }, 500);
  };
  ocr?.on('exit', (code) => {
    if (!stopping) {
      console.error(`[portal-selfservice] the receipt-ocr sidecar exited (${code}); stopping the env`);
      stop(1);
    }
  });
  api.on('exit', (code) => {
    if (!stopping) {
      console.error(`[portal-selfservice] the API exited (${code}); stopping the env`);
      stop(1);
    }
  });
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());

  mkdirSync(path.dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ origin: ORIGIN, adminToken: ADMIN_TOKEN, database: DB_NAME, container: PG_CONTAINER, operatorDigest: OPERATOR_DIGEST_ADDRESS, ocr: Boolean(ocr) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[portal-selfservice] ${err.message}`);
    dropDatabase();
    process.exit(1);
  });
}
