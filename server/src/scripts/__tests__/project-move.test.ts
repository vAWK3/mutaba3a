import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * MUT-487 (ADR-232): project-move.sh moves production from malafat-production to mtb3a-production, and back for a
 * rollback. Only the operator runs it, against real GCP, so here every CLI is a fake on PATH (gcloud, terraform, psql,
 * cloud-sql-proxy, curl) and we prove the plan's T1–T9: the generated secrets move into the new state only, and the
 * new plan keeps them (R1); no secret value ever reaches the output (AM10); images are copied tag by tag and never over
 * a tag (AM1); a live target is refused (AM7); copy refuses an open or still-written source; a mismatch stops with the
 * source closed; each step is a safe re-run; and --from/--to swapped is the rollback.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/project-move.sh');
const OLD = 'malafat-production';
const NEW = 'mtb3a-production';
const bin = mkdtempSync(join(tmpdir(), 'project-move-'));
const tfDir = join(bin, 'tf');
const calls = join(bin, 'calls.log');
// Values that must never appear in what the script prints.
const SECRETS = { db: 'OLDDBPASSWORDvalue0123456789abcdef', pepper: 'PEPPERvalue0123456789abcdef0123456789', stripe: 'rk_live_STRIPEvalue0123456789', newDb: 'NEWDBPASSWORDvalue0123456789abcdef', token: 'ya29.ACCESSTOKENvalue' };
const NODE_DIR = dirname(process.execPath);

const fakes: Record<string, string> = {
  gcloud: `#!/bin/bash
echo "gcloud $*" >> "${calls}"
args="$*"
proj=""; for a in "$@"; do case "$a" in --project=*) proj="\${a#--project=}" ;; esac; done
case "$args" in
  "run services describe"*)
    if [[ "$proj" == "${NEW}" ]]; then
      printf 'https://new.example.run\\t%s\\t%s\\t%s\\t%s\\n' "\${FAKE_NEW_IMAGE:-me-west1-docker.pkg.dev/${NEW}/mutaba3a/mutaba3a-api:abc1234}" "\${FAKE_NEW_LABEL-false}" "\${FAKE_NEW_ARGS:-}" "\${FAKE_NEW_INGRESS:-all}"
    else
      ing=all; grep -q -- "--project=${OLD} --ingress=internal" "${calls}" && ing=internal; [[ -n "$FAKE_OLD_INGRESS" ]] && ing="$FAKE_OLD_INGRESS"
      printf 'https://old.example.run\\t%s\\t%s\\t%s\\t%s\\n' "me-west1-docker.pkg.dev/${OLD}/mutaba3a/mutaba3a-api:abc1234" "\${FAKE_OLD_LABEL-}" "\${FAKE_OLD_ARGS:-}" "$ing"
    fi ;;
  "run services update"*) ;;
  "scheduler jobs list"*) if [[ -n "$FAKE_JOBS_PAUSED" ]]; then printf 'mutaba3a-account-purge,PAUSED\\n'; else printf 'mutaba3a-account-purge,ENABLED\\nmutaba3a-stripe-reconcile,PAUSED\\n'; fi ;;
  "scheduler jobs pause"*) ;;
  "sql instances describe"*) echo "$proj:me-west1:mutaba3a-pg" ;;
  "sql backups create"*) ;;
  "sql backups list"*) echo "1700000000000" ;;
  "sql backups restore"*) ;;
  "storage rsync"*) ;;
  "storage ls gs://${NEW}"*) [[ -n "$FAKE_OBJECT_MISSING" ]] && { echo "gs://${NEW}-mutaba3a-attachments/org/a/1"; exit 0; }; printf 'gs://${NEW}-mutaba3a-attachments/org/a/1\\ngs://${NEW}-mutaba3a-attachments/org/a/2\\n' ;;
  "storage ls"*) printf 'gs://${OLD}-mutaba3a-attachments/org/a/1\\ngs://${OLD}-mutaba3a-attachments/org/a/2\\n' ;;
  "storage sign-url"*) echo "https://storage.example/signed" ;;
  "auth print-access-token"*) echo "${SECRETS.token}" ;;
  "secrets versions access"*)
    case "$args" in
      *mutaba3a-api-forwarder-token*) [[ "$proj" == "${NEW}" ]] && { printf 'FWDTOKENvalue0123456789abcdef0123456789'; exit 0; }; [[ -n "$FAKE_LEGACY_HAS_TOKEN" ]] && { printf 'FWDTOKENvalue0123456789abcdef0123456789'; exit 0; }; exit 1 ;;
      *stripe-secret-key*) [[ "$proj" == "${OLD}" || -n "$FAKE_NEW_HAS_STRIPE" ]] && { printf '${SECRETS.stripe}'; exit 0; }; exit 1 ;;
      *) exit 1 ;;
    esac ;;
  "secrets versions add"*) n=$(wc -c | tr -d ' '); echo "added-bytes $n" >> "${calls}" ;;
  "artifacts docker images list"*) printf 'aaa1111\\nbbb2222,latest\\nccc3333\\nddd4444\\n' ;;
  "artifacts docker images describe me-west1-docker.pkg.dev/${OLD}"*) [[ "$args" == *":$FAKE_MISSING_TAG "* ]] && exit 1; echo "sha256:src" ;;
  "artifacts docker images describe me-west1-docker.pkg.dev/${NEW}"*) [[ -n "$FAKE_DST_TAG" && "$args" == *":$FAKE_DST_TAG "* ]] && { echo "\${FAKE_DST_DIGEST:-sha256:src}"; exit 0; }; exit 1 ;;
  "container images add-tag"*) ;;
  *) echo "unexpected gcloud call: $args" >&2; exit 98 ;;
esac
`,
  terraform: `#!/bin/bash
proj="\${TF_DATA_DIR##*/.terraform-}"
echo "terraform[$proj] $*" >> "${calls}"
case "$1 $2" in
  "init "*) exit 0 ;;
  "state list") [[ "$proj" == "${NEW}" && -n "$FAKE_NEW_HAS_SECRETS" ]] && printf 'random_password.db\\nrandom_password.admin_token\\nrandom_password.session_pepper\\nrandom_password.job_token\\nrandom_password.oauth_derive_key\\n'; exit 0 ;;
  "state pull") [[ "$proj" == "${OLD}" ]] && printf '{"resources":[{"type":"random_password","name":"db","instances":[{"attributes":{"result":"${SECRETS.db}"}}]},{"name":"session_pepper","instances":[{"attributes":{"result":"${SECRETS.pepper}"}}]}]}'; exit 0 ;;
  "state mv") for a in "$@"; do case "$a" in -state-out=*) touch "\${a#-state-out=}" ;; esac; done; exit 0 ;;
  "state push") exit 0 ;;
  "plan "*) for a in "$@"; do case "$a" in -out=*) touch "\${a#-out=}" ;; esac; done; exit 0 ;;
  "show "*)
    act='"no-op"'; [[ -n "$FAKE_PLAN_REPLACE" ]] && act='"delete","create"'
    printf '{"resource_changes":[{"address":"random_password.db","change":{"actions":[%s]}},{"address":"random_password.session_pepper","change":{"actions":["no-op"]}},{"address":"google_cloud_run_v2_service.api","change":{"actions":["create"]}}]}' "$act" ;;
  "output -raw") if [[ "$proj" == "${NEW}" ]]; then printf 'postgresql://mutaba3a_api:${SECRETS.newDb}@127.0.0.1:5440/mutaba3a'; else printf 'postgresql://mutaba3a_api:${SECRETS.db}@127.0.0.1:5440/mutaba3a'; fi ;;
  "apply "*) exit 0 ;;
  *) echo "unexpected terraform call: $*" >&2; exit 97 ;;
esac
`,
  'cloud-sql-proxy': `#!/bin/bash
echo "cloud-sql-proxy $*" >> "${calls}"
exec "${process.execPath}" -e "require('net').createServer((s) => s.end()).listen(Number(process.argv[1]), '127.0.0.1')" "$3"
`,
  psql: `#!/bin/bash
args="$*"
if [[ "$args" == *pg_stat_database* ]]; then
  w="10,5,0"; [[ -n "$FAKE_WRITES_MOVE" && -f "${bin}/writes.mark" ]] && w="10,6,0"; touch "${bin}/writes.mark"
  echo "on,$w"; exit 0
fi
if [[ "$args" == *pg_tables* ]]; then printf 'audit_events\\nusers\\n'; exit 0; fi
if [[ "$args" == *md5* ]]; then
  u="1|aaa"; [[ -n "$FAKE_MISMATCH" && "$PGPORT" == "$PROXY_PORT_TARGET" ]] && u="1|bbb"
  printf 'audit_events|5|ccc\\nusers|%s\\n' "$u"; exit 0
fi
exit 96
`,
  curl: `#!/bin/bash
echo "curl $*" >> "${calls}"
if [[ "$*" == *http_code* ]]; then printf '%s' "\${FAKE_HEALTH_CODE:-404}"; exit 0; fi
if [[ "$*" == *"-X PUT"* ]]; then n=$(wc -c | tr -d ' '); echo "put-bytes $n" >> "${calls}"; exit 0; fi
exit "\${FAKE_READY_EXIT:-0}"
`,
};
for (const [tool, body] of Object.entries(fakes)) {
  writeFileSync(join(bin, tool), body);
  chmodSync(join(bin, tool), 0o755);
}
mkdirSync(tfDir);
writeFileSync(join(tfDir, 'production.tfvars'), `project_id = "${NEW}"\n`);
writeFileSync(join(tfDir, 'legacy.tfvars'), `project_id = "${OLD}"\nlegacy_stack = true\n`);

const ports: number[] = [];
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    ports.push((server.address() as { port: number }).port);
    await new Promise((done) => server.close(done));
  }
});
afterAll(() => {
  spawnSync('pkill', ['-f', `listen\\(Number\\(process.argv\\[1\\]\\)`]);
  rmSync(bin, { recursive: true, force: true });
});

function move(env: Record<string, string>, ...args: string[]) {
  rmSync(calls, { force: true });
  rmSync(join(bin, 'writes.mark'), { force: true });
  const yes = args.includes('--dry-run') ? [] : ['--yes'];
  // setsid: no controlling terminal, so a prompt can never block on the developer's keyboard.
  const r = spawnSync('perl', ['-MPOSIX', '-e', 'POSIX::setsid(); exec @ARGV', 'bash', SCRIPT, ...args, ...yes], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${NODE_DIR}:/usr/bin:/bin`, HOME: bin, MOVE_TF_DIR: tfDir, PROXY_PORT_SOURCE: String(ports[0]), PROXY_PORT_TARGET: String(ports[1]), DRAIN_SECONDS: '0', ...env },
    input: '',
    timeout: 60_000,
  });
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  return { status: r.status, out: r.stdout, err: r.stderr, calls: log };
}
const forward = (step: string, env: Record<string, string> = {}, ...extra: string[]) => move(env, step, '--from', OLD, '--to', NEW, ...extra);
const backward = (step: string, env: Record<string, string> = {}, ...extra: string[]) => move(env, step, '--from', NEW, '--to', OLD, ...extra);
const noSecretIn = (text: string) => Object.values(SECRETS).forEach((value) => expect(text).not.toContain(value));
const has = (lines: string[], pattern: RegExp) => lines.some((l) => pattern.test(l));

describe('project-move.sh (MUT-487)', { timeout: 60_000 }, () => {
  it('needs a step, --from and --to, and refuses a project config/gcp.json doesn\'t name', () => {
    expect(move({}, '--from', OLD, '--to', NEW).status).toBe(2);
    expect(move({}, 'copy', '--from', OLD).status).toBe(2);
    const r = move({}, 'copy', '--from', 'someone-else', '--to', NEW);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/someone-else is neither config\/gcp.json's project/);
  });

  describe('secrets (R1)', () => {
    it('moves the five generated secrets into the new state, pushes only the new state, and checks the plan keeps them', () => {
      const r = forward('secrets');
      expect(r.status, r.err).toBe(0);
      expect(r.calls.filter((l) => / state mv /.test(l))).toHaveLength(5);
      for (const name of ['db', 'admin_token', 'session_pepper', 'job_token', 'oauth_derive_key']) {
        expect(has(r.calls, new RegExp(`^terraform\\[${NEW}\\] state mv -state=.*from.tfstate -state-out=.*to.tfstate random_password.${name} random_password.${name}$`))).toBe(true);
      }
      expect(r.calls.filter((l) => / state push /.test(l))).toEqual([expect.stringMatching(new RegExp(`^terraform\\[${NEW}\\] state push `))]);
      expect(has(r.calls, new RegExp(`^terraform\\[${OLD}\\] state (push|mv|rm)`))).toBe(false);
      expect(r.out).toMatch(/the plan keeps all five generated secrets/);
      expect(r.out).toMatch(/-replace=random_password.db -replace=random_password.admin_token -replace=random_password.job_token/);
      noSecretIn(r.out + r.err);
    });

    it('stops when the new plan would replace one of them (everyone would be signed out)', () => {
      const r = forward('secrets', { FAKE_PLAN_REPLACE: '1' });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/would change random_password.db delete\+create/);
      noSecretIn(r.out + r.err);
    });

    it('is a safe re-run: with all five already in the new state it moves nothing and only re-checks the plan', () => {
      const r = forward('secrets', { FAKE_NEW_HAS_SECRETS: '1' });
      expect(r.status, r.err).toBe(0);
      expect(has(r.calls, / state (mv|push|pull)/)).toBe(false);
      expect(r.out).toMatch(/already holds all five/);
    });

    it('only ever moves them into config/gcp.json\'s project', () => {
      expect(backward('secrets').err).toMatch(/into mtb3a-production's state only/);
    });
  });

  describe('secret-values (AM10, R5)', () => {
    it('copies the operator secrets and the forwarder token through a pipe, never printing a value', () => {
      const r = forward('secret-values');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toMatch(/mutaba3a-api-stripe-secret-key: copied to mtb3a-production/);
      expect(r.err).toMatch(/mutaba3a-api-resend-api-key has no version in malafat-production/);
      expect(r.out).toMatch(/mutaba3a-api-forwarder-token: copied to malafat-production/);
      expect(r.calls.filter((l) => l.startsWith('added-bytes'))).toHaveLength(2);
      expect(r.calls.join('\n')).not.toContain(SECRETS.stripe); // not on any argv either
      noSecretIn(r.out + r.err);
    });

    it('is a safe re-run: a secret the target already holds is skipped', () => {
      const r = forward('secret-values', { FAKE_NEW_HAS_STRIPE: '1', FAKE_LEGACY_HAS_TOKEN: '1' });
      expect(r.status, r.err).toBe(0);
      expect(r.calls.filter((l) => l.startsWith('added-bytes'))).toHaveLength(0);
    });
  });

  describe('images (AM1, MUT-347)', () => {
    it('copies the three newest tags with add-tag', () => {
      const r = forward('images');
      expect(r.status, r.err).toBe(0);
      const added = r.calls.filter((l) => l.startsWith('gcloud container images add-tag'));
      expect(added).toEqual(['aaa1111', 'bbb2222', 'latest'].map((t) => `gcloud container images add-tag me-west1-docker.pkg.dev/${OLD}/mutaba3a/mutaba3a-api:${t} me-west1-docker.pkg.dev/${NEW}/mutaba3a/mutaba3a-api:${t} --quiet`));
    });

    it('skips a tag the target already holds with the same image, and refuses one that holds another', () => {
      const same = forward('images', { FAKE_DST_TAG: 'aaa1111' }, '--tags', 'aaa1111');
      expect(same.status, same.err).toBe(0);
      expect(has(same.calls, /add-tag/)).toBe(false);
      const other = forward('images', { FAKE_DST_TAG: 'aaa1111', FAKE_DST_DIGEST: 'sha256:other' }, '--tags', 'aaa1111');
      expect(other.status).not.toBe(0);
      expect(other.err).toMatch(/already holds another image .* never pushed over/);
    });

    it('stops at a source tag that doesn\'t exist', () => {
      const r = forward('images', { FAKE_MISSING_TAG: 'zzz9999' }, '--tags', 'aaa1111,zzz9999,ccc3333');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/:zzz9999 doesn't exist/);
      expect(has(r.calls, /add-tag .*ccc3333/)).toBe(false);
    });
  });

  describe('rehearse and copy (AM7, AM3, R7)', () => {
    it('rehearse refuses a live target, and one with no label (fail closed)', () => {
      for (const label of ['true', '']) {
        const r = forward('rehearse', { FAKE_NEW_LABEL: label });
        expect(r.status, label).not.toBe(0);
        expect(r.err).toMatch(/is live \(label mtb3a-live=/);
        expect(has(r.calls, /sql backups (create|restore)/)).toBe(false);
      }
    });

    it('rehearse copies into a target that isn\'t live, with the source open: backup, cross-project restore, password, rsync, verify', () => {
      const r = forward('rehearse');
      expect(r.status, r.err).toBe(0);
      expect(has(r.calls, new RegExp(`^gcloud sql backups restore 1700000000000 --restore-instance=mutaba3a-pg --backup-instance=mutaba3a-pg --backup-project=${OLD} --project=${NEW} `))).toBe(true);
      expect(has(r.calls, new RegExp(`^curl -fsS -X PUT .*sqladmin.googleapis.com/v1/projects/${NEW}/instances/mutaba3a-pg/users\\?name=mutaba3a_api`))).toBe(true);
      expect(has(r.calls, new RegExp(`^gcloud storage rsync gs://${OLD}-mutaba3a-attachments gs://${NEW}-mutaba3a-attachments --recursive --delete-unmatched-destination-objects`))).toBe(true);
      expect(has(r.calls, /--ingress/)).toBe(false);
      expect(r.out).toMatch(/every table matches: 2 tables/);
      expect(r.out).toMatch(/a receipt downloads through a signed URL/);
      expect(r.out).toContain('gcloud run services proxy mutaba3a-api');
      noSecretIn(r.out + r.err + r.calls.join('\n'));
    });

    it('copy refuses a source that is still open, or still answers from outside', () => {
      const open = forward('copy', { FAKE_OLD_INGRESS: 'all' });
      expect(open.status).not.toBe(0);
      expect(open.err).toMatch(/is open \(ingress all\): run freeze first/);
      const answers = forward('copy', { FAKE_OLD_INGRESS: 'internal', FAKE_HEALTH_CODE: '200' });
      expect(answers.err).toMatch(/still answers \/health from outside/);
      for (const r of [open, answers]) expect(has(r.calls, /sql backups create/)).toBe(false);
    });

    it('copy refuses while the source\'s write counters still move', () => {
      const r = forward('copy', { FAKE_OLD_INGRESS: 'internal', FAKE_WRITES_MOVE: '1' });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/still being written to .* Malafat's VPC egress/);
      expect(has(r.calls, /sql backups create/)).toBe(false);
    });

    it('a count or checksum mismatch stops the cutover with the source left closed', () => {
      const r = forward('copy', { FAKE_OLD_INGRESS: 'internal', FAKE_MISMATCH: '1' });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/doesn't match malafat-production: malafat-production stays closed/);
      expect(has(r.calls, /--ingress=all/)).toBe(false);
      expect(has(r.calls, / apply /)).toBe(false);
    });

    it('a missing receipt object stops it too', () => {
      const r = forward('verify', { FAKE_OBJECT_MISSING: '1' });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/receipt objects differ/);
    });
  });

  describe('freeze', () => {
    it('closes the source, pauses only the jobs that run, then checks the writes hold still', () => {
      const r = forward('freeze');
      expect(r.status, r.err).toBe(0);
      expect(has(r.calls, new RegExp(`^gcloud run services update mutaba3a-api --region=me-west1 --project=${OLD} --ingress=internal`))).toBe(true);
      expect(r.calls.filter((l) => l.startsWith('gcloud scheduler jobs pause'))).toEqual([`gcloud scheduler jobs pause mutaba3a-account-purge --location=me-west1 --project=${OLD} --quiet`]);
      expect(r.out).toMatch(/holds still \(10,5,0\)/);
    });

    it('is a safe re-run: already closed and paused, it changes nothing', () => {
      const r = forward('freeze', { FAKE_OLD_INGRESS: 'internal', FAKE_JOBS_PAUSED: '1' });
      expect(r.status, r.err).toBe(0);
      expect(has(r.calls, /run services update|scheduler jobs pause/)).toBe(false);
    });
  });

  describe('open and forward (R6/D7)', () => {
    it('open verifies first, then applies the target with api_public, the jobs and the live label on, and checks /ready', () => {
      const r = forward('open');
      expect(r.status, r.err).toBe(0);
      const apply = r.calls.findIndex((l) => l.startsWith(`terraform[${NEW}] apply`));
      expect(apply).toBeGreaterThan(r.calls.findIndex((l) => l.startsWith('gcloud storage sign-url')));
      expect(r.calls[apply]).toBe(`terraform[${NEW}] apply -input=false -var-file=production.tfvars -var image_tag=abc1234 -var api_public=true -var scheduler_paused=false -var live_label=true -auto-approve`);
      expect(has(r.calls, /^curl -fsS --max-time 30 -o \/dev\/null https:\/\/new.example.run\/ready/)).toBe(true);
    });

    it('open does nothing when verify fails', () => {
      const r = forward('open', { FAKE_MISMATCH: '1' });
      expect(r.status).not.toBe(0);
      expect(has(r.calls, / apply /)).toBe(false);
    });

    it('forward goes only from the legacy project to the live one, and prints the forwarder apply', () => {
      expect(backward('forward', {}, '--dry-run').err).toMatch(/forward turns malafat-production's service into the forwarder/);
      const r = forward('forward', {}, '--dry-run');
      expect(r.status, r.err).toBe(0);
      expect(r.out).toMatch(new RegExp(`\\+ tf ${OLD} apply -input=false -var-file=legacy.tfvars -var image_tag=<tag> -var legacy_forwarder=true -var forward_to=https://<service>.a.run.app -var api_ingress=INGRESS_TRAFFIC_ALL -var min_instances=0`));
    });

    it('forward refuses before the new service is open', () => {
      const r = forward('forward', { FAKE_NEW_LABEL: 'false' });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/isn't open yet/);
      expect(has(r.calls, / apply /)).toBe(false);
    });
  });

  describe('the rollback (--from and --to swapped)', () => {
    it('copying back into the old project\'s forwarder needs --rollback', () => {
      const env = { FAKE_NEW_INGRESS: 'internal', FAKE_OLD_LABEL: 'true', FAKE_OLD_ARGS: 'dist/forwarder.js' };
      const refused = backward('copy', env);
      expect(refused.status).not.toBe(0);
      expect(refused.err).toMatch(/is the legacy forwarder: copying into it is the rollback, so pass --rollback/);
      const r = backward('copy', env, '--rollback');
      expect(r.status, r.err).toBe(0);
      expect(has(r.calls, new RegExp(`^gcloud sql backups restore 1700000000000 .*--backup-project=${NEW} --project=${OLD} `))).toBe(true);
      expect(has(r.calls, new RegExp(`sqladmin.googleapis.com/v1/projects/${OLD}/`))).toBe(true);
    });

    it('--rollback never lets a copy over a live API through', () => {
      const r = backward('copy', { FAKE_NEW_INGRESS: 'internal', FAKE_OLD_LABEL: 'true' }, '--rollback');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/is live/);
    });

    it('reopening the old project turns the forwarder off, with --rollback only', () => {
      const env = { FAKE_NEW_INGRESS: 'internal' };
      expect(backward('open', env).err).toMatch(/pass --rollback/);
      const r = backward('open', env, '--rollback');
      expect(r.status, r.err).toBe(0);
      expect(r.calls.find((l) => l.startsWith(`terraform[${OLD}] apply`))).toBe(`terraform[${OLD}] apply -input=false -var-file=legacy.tfvars -var image_tag=abc1234 -var legacy_forwarder=false -var api_ingress=INGRESS_TRAFFIC_ALL -var scheduler_paused=false -auto-approve`);
    });
  });
});
