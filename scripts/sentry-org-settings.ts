/**
 * MUT-147 (ADR-091, R9): set or check the Sentry org's privacy settings, which Terraform can't
 * hold: Require Data Scrubber, default scrubbers, Prevent storing IP addresses, and the org's
 * sensitive fields (the scrub contract's deny tokens).
 *
 *   SENTRY_AUTH_TOKEN=<admin token> SENTRY_ORG=barmajiyat npx tsx scripts/sentry-org-settings.ts --apply
 *   SENTRY_AUTH_TOKEN=<admin token> SENTRY_ORG=barmajiyat npx tsx scripts/sentry-org-settings.ts --check
 *
 * Exits 1 on drift or any API error. See server/DEPLOYMENT.md §1.5.
 */
import { readFileSync } from 'node:fs';
import { desiredOrgSettings, parseOrgSettingsArgs, syncOrgSettings } from './sentry-org-policy';

const RULES_PATH = 'docs/observability/sentry-rules.json';

try {
  const args = parseOrgSettingsArgs(process.argv.slice(2), process.env);
  const desired = desiredOrgSettings(JSON.parse(readFileSync(RULES_PATH, 'utf8')));
  const drift = await syncOrgSettings(args, desired, fetch);
  if (drift.length > 0) {
    console.error(`Sentry org "${args.org}" does not match ${RULES_PATH}:`);
    for (const entry of drift) console.error(`  ${entry.field}: expected ${entry.expected}, found ${entry.actual}`);
    process.exit(1);
  }
  console.log(`Sentry org "${args.org}" privacy settings ${args.mode === 'apply' ? 'applied and verified' : 'match'}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
