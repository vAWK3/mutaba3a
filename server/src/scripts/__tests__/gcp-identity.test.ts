import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * lib/gcp-identity.sh (MUT-523): who a release, a move or a drill acts as, for that process only. deploy.env (per
 * checkout, git-ignored) may set GCP_ACCOUNT and GCP_ADC_FILE; the scripts turn them into CLOUDSDK_CORE_ACCOUNT (gcloud)
 * and GOOGLE_APPLICATION_CREDENTIALS (Terraform, cloud-sql-proxy, the client libraries). Nothing machine-wide changes:
 * no `gcloud config set account`, no `gcloud auth application-default login` over the default file. A checkout that
 * sets neither runs exactly as before, on the machine's defaults.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/gcp-identity.sh');
const TOKEN = 'ya29.IDENTITYTOKENvalue0123456789';
let dir: string;
let bin: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gcp-identity-'));
  bin = join(dir, 'bin');
  log = join(dir, 'calls.log');
  mkdirSync(bin);
  // gcloud prints a token only when GOOGLE_APPLICATION_CREDENTIALS names a file; curl answers tokeninfo with FAKE_EMAIL.
  writeFileSync(
    join(bin, 'gcloud'),
    `#!/bin/bash\necho "gcloud $* GAC=\${GOOGLE_APPLICATION_CREDENTIALS:-} ACCOUNT=\${CLOUDSDK_CORE_ACCOUNT:-}" >> "${log}"\ncase "$*" in\n  "auth application-default print-access-token"*) [[ -n "\${FAKE_NO_TOKEN:-}" ]] && exit 1; printf '%s\\n' '${TOKEN}' ;;\nesac\n`,
  );
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/bash\necho "curl $*" >> "${log}"\nbody="$(cat)"; echo "curl-stdin-bytes \${#body}" >> "${log}"\n[[ "$body" == "access_token=${TOKEN}" ]] || exit 22\nprintf '{"email":"%s","email_verified":"true"}' "\${FAKE_EMAIL:-ops@example.com}"\n`,
  );
  chmodSync(join(bin, 'gcloud'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(script: string, env: Record<string, string> = {}) {
  const e: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, ...env };
  for (const key of ['GCP_ACCOUNT', 'GCP_ADC_FILE', 'CLOUDSDK_CORE_ACCOUNT', 'GOOGLE_APPLICATION_CREDENTIALS']) if (!(key in env)) delete e[key];
  const r = spawnSync('bash', ['-c', `die() { echo "DIE: $*" >&2; exit 1; }; info() { echo "INFO: $*"; }; source "${LIB}"; ${script}`], { encoding: 'utf8', env: e });
  let calls = '';
  try {
    calls = readFileSync(log, 'utf8');
  } catch {
    /* no calls */
  }
  return { status: r.status, out: r.stdout, err: r.stderr, calls };
}
const adcFile = () => {
  const file = join(dir, 'adc-ops.json');
  writeFileSync(file, '{"type":"authorized_user","account":""}');
  return file;
};

describe('use_gcp_identity', () => {
  it('maps GCP_ACCOUNT to CLOUDSDK_CORE_ACCOUNT and GCP_ADC_FILE to GOOGLE_APPLICATION_CREDENTIALS, exported to children', () => {
    const file = adcFile();
    const r = run('use_gcp_identity && bash -c \'echo "$CLOUDSDK_CORE_ACCOUNT|$GOOGLE_APPLICATION_CREDENTIALS"\'', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: file });
    expect(r.status, r.err).toBe(0);
    expect(r.out.trim()).toBe(`ops@example.com|${file}`);
  });

  it('expands a leading ~/ (make passes deploy.env values literally)', () => {
    const file = adcFile();
    const r = run('use_gcp_identity && echo "$GOOGLE_APPLICATION_CREDENTIALS"', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: '~/adc-ops.json' });
    expect(r.status, r.err).toBe(0);
    expect(r.out.trim()).toBe(file);
  });

  it('changes nothing when neither is set: the machine\'s defaults, as before', () => {
    const r = run('use_gcp_identity && echo "[${CLOUDSDK_CORE_ACCOUNT:-}|${GOOGLE_APPLICATION_CREDENTIALS:-}]" && gcp_identity_summary', {});
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('[|]');
    expect(r.out).toContain("the machine's defaults");
    expect(r.calls).toBe('');
  });

  it('refuses one without the other: gcloud and Terraform would act as different people', () => {
    expect(run('use_gcp_identity', { GCP_ACCOUNT: 'ops@example.com' }).err).toMatch(/DIE: GCP_ACCOUNT and GCP_ADC_FILE go together/);
    expect(run('use_gcp_identity', { GCP_ADC_FILE: adcFile() }).err).toMatch(/DIE: GCP_ACCOUNT and GCP_ADC_FILE go together/);
  });

  it('refuses a credentials file that doesn\'t exist, and names the runbook step that makes it', () => {
    const r = run('use_gcp_identity', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: join(dir, 'missing.json') });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/DIE: GCP_ADC_FILE=.*missing.json doesn't exist.*DEPLOYMENT.md §6d C0/);
  });

  it('gcp_identity_summary names the account and the file', () => {
    const file = adcFile();
    const r = run('use_gcp_identity && gcp_identity_summary', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: file });
    expect(r.out.trim()).toBe(`gcloud account ops@example.com, credentials ${file}`);
  });
});

describe('adc_account_of', () => {
  it('prints the email the credentials file signs in as, with the token on stdin only, never argv', () => {
    const file = adcFile();
    const r = run(`adc_account_of "${file}"`, { FAKE_EMAIL: 'ops@example.com' });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toBe('ops@example.com');
    expect(r.calls).toContain(`gcloud auth application-default print-access-token GAC=${file}`);
    expect(r.calls).toMatch(/^curl .*oauth2.googleapis.com\/tokeninfo/m);
    expect(r.calls).not.toContain(TOKEN);
    expect(r.out + r.err).not.toContain(TOKEN);
  });

  it('fails when the file yields no token', () => {
    const r = run(`adc_account_of "${adcFile()}"`, { FAKE_NO_TOKEN: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toBe('');
  });
});

describe('gcp_identity_problems (preflight)', () => {
  it('is empty when the file signs in as GCP_ACCOUNT', () => {
    const r = run('use_gcp_identity && gcp_identity_problems', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: adcFile(), FAKE_EMAIL: 'ops@example.com' });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toBe('');
  });

  it('names the mismatch when the file signs in as someone else', () => {
    const r = run('use_gcp_identity && gcp_identity_problems', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: adcFile(), FAKE_EMAIL: 'someone@example.com' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/signs in as someone@example.com, not GCP_ACCOUNT=ops@example.com/);
  });

  it('names a file it can\'t read an account from', () => {
    const r = run('use_gcp_identity && gcp_identity_problems', { GCP_ACCOUNT: 'ops@example.com', GCP_ADC_FILE: adcFile(), FAKE_NO_TOKEN: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/could not get a token from .*adc-ops.json/);
  });

  it('is empty, and calls nothing, on the machine\'s defaults', () => {
    const r = run('gcp_identity_problems', {});
    expect(r.status).toBe(0);
    expect(r.calls).toBe('');
  });
});

describe('the scripts that act on GCP all take the identity (MUT-523)', () => {
  const server = resolve(process.cwd(), 'scripts');
  it.each(['deploy.sh', 'project-move.sh', 'restore-drill.sh'])('%s sources lib/gcp-identity.sh and calls use_gcp_identity before its first gcloud call', (file) => {
    const src = readFileSync(join(server, file), 'utf8');
    expect(src).toMatch(/lib\/gcp-identity\.sh/);
    const at = src.search(/^use_gcp_identity$/m);
    expect(at).toBeGreaterThan(-1);
    const firstGcloud = src.search(/^[^#\n]*\bgcloud (run|sql|config|auth|secrets|storage|scheduler|artifacts|container)\b/m);
    expect(at).toBeLessThan(firstGcloud);
  });

  it('preflight checks it, and the Makefile exports both settings from deploy.env', () => {
    const root = resolve(process.cwd(), '..');
    expect(readFileSync(join(root, 'scripts/preflight.sh'), 'utf8')).toMatch(/gcp_identity_problems/);
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toMatch(/^export [^\n]*\bGCP_ACCOUNT GCP_ADC_FILE\b/m);
    const example = readFileSync(join(root, 'deploy.env.example'), 'utf8');
    expect(example).toMatch(/^# GCP_ACCOUNT=barmajiyatltd@gmail.com$/m);
    expect(example).toMatch(/^# GCP_ADC_FILE=~\/\.config\/gcloud\/adc-barmajiyatltd\.json$/m);
  });
});
