/**
 * MUT-147 (ADR-091, R9): set or check the Sentry org's privacy settings, which Terraform can't
 * hold: Require Data Scrubber, default scrubbers, Prevent storing IP addresses, Enhanced Privacy,
 * no shared issues, required 2FA, no safe fields, and the curated sensitive fields.
 *
 *   SENTRY_ADMIN_TOKEN=<admin token> SENTRY_ORG=mutaba3a npx tsx scripts/sentry-org-settings.ts --apply
 *   SENTRY_ADMIN_TOKEN=<admin token> SENTRY_ORG=mutaba3a npx tsx scripts/sentry-org-settings.ts --check
 *
 * Exits 1 on drift, an org outside the EU region, or any API error. See server/DEPLOYMENT.md §1.5.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { desiredOrgSettings, expectedRegionUrl, parseOrgSettingsArgs, syncOrgSettings } from './sentry-org-policy';

const RULES_DISPLAY = 'docs/observability/sentry-rules.json';
/** Resolved from this file, so the script works from any directory (QA 2026-10-17). */
const RULES_URL = new URL('../docs/observability/sentry-rules.json', import.meta.url);

try {
  const rules = JSON.parse(readFileSync(fileURLToPath(RULES_URL), 'utf8'));
  const args = parseOrgSettingsArgs(process.argv.slice(2), process.env);
  console.log(`Target: Sentry org "${args.org}" at ${args.baseUrl} (${args.mode}).`);
  const drift = await syncOrgSettings(args, desiredOrgSettings(rules), expectedRegionUrl(rules), fetch);
  if (drift.length > 0) {
    console.error(`Sentry org "${args.org}" does not match ${RULES_DISPLAY}:`);
    for (const entry of drift) console.error(`  ${entry.field}: expected ${entry.expected}, found ${entry.actual}`);
    process.exit(1);
  }
  console.log(`Sentry org "${args.org}" privacy settings ${args.mode === 'apply' ? 'applied and verified' : 'match'}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
