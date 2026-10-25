import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * MUT-347: what deploy.sh knows about an image tag before it builds or rolls back, read from Artifact
 * Registry's Docker v2 API with `REGISTRY_TOKEN` (deploy.sh passes `gcloud auth print-access-token`), so a
 * rollback needs no docker daemon.
 *
 *   npm run --silent release-image -- deploy-plan --image <ref:tag> --head <full sha> --dirty 0|1 --config <sha256>
 *       Prints `build` (the tag is free) or `reuse` (it already holds this clean HEAD, built with the same portal
 *       settings). Refuses (exit 1) a tag that holds anything else: deploy.sh never pushes over a tag, so an old
 *       image is never destroyed.
 *   npm run --silent release-image -- rollback --repository <registry>/mutaba3a-api --commit <full sha>
 *       Prints the tag of that commit's image (its short sha) after checking the image's labels.
 *
 * deploy.sh labels every image it builds with REVISION_LABEL (the full commit), DIRTY_LABEL (true when IMAGE_TAG
 * let a dirty tree through) and CONFIG_LABEL (a sha256 of ENVIRONMENT and every MUTABA3A_* setting the portal bundle
 * is built with, from deploy.env). Images built before MUT-347 have none of them.
 */
export const REVISION_LABEL = 'org.opencontainers.image.revision';
export const DIRTY_LABEL = 'dirty';
export const CONFIG_LABEL = 'portal-config';

const TIMEOUT_MS = 30_000;
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');
/** A git short sha as `git rev-parse --short` prints it. */
const SHORT_SHA = /^[0-9a-f]{7,40}$/;

export interface ImageRef {
  host: string;
  name: string;
  tag: string;
}
export type ImageLabels = Record<string, string>;

export function parseImageRef(image: string): ImageRef {
  const m = /^([^/]+)\/(.+):([^:/]+)$/.exec(image);
  if (!m) throw new Error(`${image} is not <host>/<path>:<tag>`);
  const [, host, name, tag] = m as unknown as [string, string, string, string];
  return { host, name, tag };
}

async function get(url: string, token: string, fetchImpl: typeof fetch, accept?: string): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (accept) headers.accept = accept;
  return fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function json(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`the registry answered HTTP ${res.status} for ${what}`);
  return res.json();
}

interface Manifest {
  manifests?: { digest: string; platform?: { os?: string; architecture?: string } }[];
  config?: { digest?: string };
}

/** The image's config labels; null when the registry has no such tag. Throws on any other failure. */
export async function imageLabels(ref: ImageRef, token: string, fetchImpl: typeof fetch = fetch): Promise<ImageLabels | null> {
  const base = `https://${ref.host}/v2/${ref.name}`;
  const res = await get(`${base}/manifests/${ref.tag}`, token, fetchImpl, MANIFEST_TYPES);
  if (res.status === 404) return null;
  let manifest = (await json(res, `${ref.name}:${ref.tag}`)) as Manifest;
  if (manifest.manifests) {
    const amd64 = manifest.manifests.find((m) => m.platform?.os === 'linux' && m.platform.architecture === 'amd64');
    if (!amd64) throw new Error(`${ref.name}:${ref.tag} has no linux/amd64 image`);
    manifest = (await json(await get(`${base}/manifests/${amd64.digest}`, token, fetchImpl, MANIFEST_TYPES), amd64.digest)) as Manifest;
  }
  const digest = manifest.config?.digest;
  if (!digest) throw new Error(`${ref.name}:${ref.tag}'s manifest names no config`);
  const config = (await json(await get(`${base}/blobs/${digest}`, token, fetchImpl), digest)) as { config?: { Labels?: ImageLabels | null } };
  return config.config?.Labels ?? {};
}

/** Every tag in the repository, following the registry's pagination. */
export async function listTags(host: string, name: string, token: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const tags: string[] = [];
  let url: string | null = `https://${host}/v2/${name}/tags/list`;
  while (url) {
    const res = await get(url, token, fetchImpl);
    const page = (await json(res, `${name}'s tags`)) as { tags?: string[] | null };
    tags.push(...(page.tags ?? []));
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
    const nextUrl = next ? new URL(next, `https://${host}`) : null;
    // The token only ever goes to the registry itself.
    if (nextUrl && nextUrl.host !== host) throw new Error(`the registry's next page is on another host (${nextUrl.host})`);
    url = nextUrl?.href ?? null;
  }
  return tags;
}

/** The tag deploy.sh gave `commit`'s image (its short sha); the longest when two lengths exist. */
export function tagForCommit(tags: string[], commit: string): string | null {
  const matches = tags.filter((t) => SHORT_SHA.test(t) && commit.startsWith(t));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export type DeployPlan = { action: 'build' } | { action: 'reuse' } | { action: 'refuse'; reason: string };

/**
 * A normal deploy: build a free tag, reuse an image of this clean HEAD built with the same portal settings, never
 * push over anything else. An unlabelled image (from before MUT-347) is never reused: nothing says what it holds.
 */
export function deployImagePlan(o: { labels: ImageLabels | null; tag: string; head: string; treeDirty: boolean; config: string }): DeployPlan {
  if (o.labels === null) return { action: 'build' };
  const revision = o.labels[REVISION_LABEL];
  const pickAnother = 'deploy.sh never pushes over a tag; pick another IMAGE_TAG, or roll back with ROLLBACK_TO=';
  if (revision && revision !== o.head) {
    return { action: 'refuse', reason: `${o.tag} already names an image built from ${revision.slice(0, 12)}, not HEAD ${o.head.slice(0, 12)}: ${pickAnother}` };
  }
  if (o.labels[DIRTY_LABEL] === 'true' || o.treeDirty) {
    return { action: 'refuse', reason: `${o.tag} already names an image, and ${o.treeDirty ? 'this tree is dirty' : 'it was built from a dirty tree'}, so nothing proves it holds what you deploy: ${pickAnother}` };
  }
  if (!revision) {
    return { action: 'refuse', reason: `${o.tag} already names an image with no labels (built before MUT-347), so nothing says which commit or portal settings it holds: ${pickAnother}` };
  }
  if (o.labels[CONFIG_LABEL] !== o.config) {
    return { action: 'refuse', reason: `${o.tag} was built with other portal build settings (ENVIRONMENT or deploy.env's MUTABA3A_* changed since), which its bundle bakes in: ${pickAnother}` };
  }
  return { action: 'reuse' };
}

export type RollbackCheck = { ok: true; warning?: string } | { ok: false; reason: string };

/** A rollback: the image must be the commit's, built from a clean tree. */
export function rollbackImageCheck(o: { labels: ImageLabels | null; commit: string }): RollbackCheck {
  if (o.labels === null) return { ok: false, reason: `the image for ${o.commit.slice(0, 12)} is gone from the registry` };
  const revision = o.labels[REVISION_LABEL];
  if (revision && revision !== o.commit) return { ok: false, reason: `that tag's image was built from ${revision.slice(0, 12)}, not ${o.commit.slice(0, 12)}` };
  if (o.labels[DIRTY_LABEL] === 'true') return { ok: false, reason: `the image for ${o.commit.slice(0, 12)} was built from a dirty tree, so it may not be that commit` };
  if (!revision) return { ok: true, warning: `the image for ${o.commit.slice(0, 12)} has no revision label (built before MUT-347): only its tag says which commit it is` };
  return { ok: true };
}

interface CliDeps {
  fetchImpl?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export async function releaseImageCli(argv: string[], env: NodeJS.ProcessEnv, deps: CliDeps = {}): Promise<number> {
  const { fetchImpl = fetch, out = (s: string) => console.log(s), err = (s: string) => console.error(s) } = deps;
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      image: { type: 'string' },
      head: { type: 'string' },
      dirty: { type: 'string' },
      config: { type: 'string' },
      repository: { type: 'string' },
      commit: { type: 'string' },
    },
  });
  const token = env.REGISTRY_TOKEN;
  if (!token) {
    err('[image] REGISTRY_TOKEN is not set (deploy.sh passes `gcloud auth print-access-token`)');
    return 1;
  }
  try {
    if (positionals[0] === 'deploy-plan' && values.image && values.head && values.dirty && values.config) {
      const ref = parseImageRef(values.image);
      const labels = await imageLabels(ref, token, fetchImpl);
      const plan = deployImagePlan({ labels, tag: ref.tag, head: values.head, treeDirty: values.dirty === '1', config: values.config });
      if (plan.action === 'refuse') {
        err(`[image] ${plan.reason}`);
        return 1;
      }
      out(plan.action);
      return 0;
    }
    if (positionals[0] === 'rollback' && values.repository && values.commit) {
      const repo = parseImageRef(`${values.repository}:x`);
      const tag = tagForCommit(await listTags(repo.host, repo.name, token, fetchImpl), values.commit);
      if (!tag) {
        err(`[image] no image in ${values.repository} for ${values.commit.slice(0, 12)}: it was never deployed, or only under an IMAGE_TAG name (roll back to that by hand, DEPLOYMENT.md §6)`);
        return 1;
      }
      const check = rollbackImageCheck({ labels: await imageLabels({ ...repo, tag }, token, fetchImpl), commit: values.commit });
      if (!check.ok) {
        err(`[image] ${check.reason}`);
        return 1;
      }
      if (check.warning) err(`[image] ${check.warning}`);
      out(tag);
      return 0;
    }
  } catch (error) {
    err(`[image] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  err('usage: release-image deploy-plan --image <ref:tag> --head <sha> --dirty 0|1 --config <sha256> | release-image rollback --repository <ref> --commit <sha>');
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void releaseImageCli(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
