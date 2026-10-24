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
 *   3. the API on 127.0.0.1:8791, which is also the portal's origin.
 *
 * Cloudflare's widget script is answered by the specs themselves (support/turnstile.ts), never fetched.
 * It writes qa/.state/portal-selfservice.json (origin, admin token, database name) for the specs, and drops the
 * database and stops the API on SIGINT/SIGTERM. Ports 8787-8790 belong to other sessions' dev APIs and portal-live.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_PORT = 8791;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = `http://127.0.0.1:${API_PORT}`;
const PG_CONTAINER = 'mutaba3a-test-pg';
const DB_NAME = `mutaba3a_qa_selfservice_${process.pid}`;
const DATABASE_URL = `postgresql://mutaba3a:mutaba3a@localhost:54329/${DB_NAME}`;
const DIST = path.join(ROOT, 'qa', '.state', 'selfservice-dist');
const STATE = path.join(ROOT, 'qa', '.state', 'portal-selfservice.json');
// Local QA-only values, not secrets: the API runs on loopback for the length of a QA run.
const ADMIN_TOKEN = 'qa-portal-selfservice-admin-token-0123456789';
const PEPPER = 'qa-portal-selfservice-session-pepper-0123456789';

/** A shell that exports APPLE_TEAM_ID for fastlane would half-set the API's app association, which it refuses. */
const APP_ASSOCIATION_VARS = ['APPLE_TEAM_ID', 'APPLE_BUNDLE_ID', 'ANDROID_PACKAGE_NAME', 'ANDROID_SHA256_FINGERPRINTS'];
/** Anything mail- or signup-shaped in the operator's shell would change what the QA server does. */
const SELF_SERVICE_VARS = ['MAILER', 'TURNSTILE_SECRET', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO', 'SELF_SIGNUP_ENABLED', 'EMAIL_DOMAIN_CHECKER', 'OPERATOR_ALERT_EMAIL'];
const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !APP_ASSOCIATION_VARS.includes(name) && !SELF_SERVICE_VARS.includes(name)));

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
  execFileSync('npx', ['vite', 'build', '--mode', 'hosted', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });
}

async function main() {
  buildPortal();
  createDatabase();

  let stopping = false;
  const api = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    stdio: 'inherit',
    env: {
      ...cleanEnv(process.env),
      NODE_ENV: 'development',
      PORT: String(API_PORT),
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
      RECOVERY_RESPONSE_FLOOR_MS: '100',
    },
  });
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    api.kill('SIGTERM');
    setTimeout(() => {
      dropDatabase();
      rmSync(STATE, { force: true });
      process.exit(code);
    }, 500);
  };
  api.on('exit', (code) => {
    if (!stopping) {
      console.error(`[portal-selfservice] the API exited (${code}); stopping the env`);
      stop(1);
    }
  });
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());

  mkdirSync(path.dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ origin: ORIGIN, adminToken: ADMIN_TOKEN, database: DB_NAME, container: PG_CONTAINER }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[portal-selfservice] ${err.message}`);
    dropDatabase();
    process.exit(1);
  });
}
