import { describe, expect, it } from 'vitest';
import {
  DIRTY_LABEL,
  deployImagePlan,
  imageLabels,
  listTags,
  parseImageRef,
  releaseImageCli,
  REVISION_LABEL,
  rollbackImageCheck,
  tagForCommit,
} from '../release-image.js';

/**
 * MUT-347: deploy.sh never pushes over an image tag, reuses an image it already built, and a rollback
 * (ROLLBACK_TO) deploys an image that already exists for that commit. Labels are read from the registry's
 * Docker v2 API, so a rollback needs no docker daemon.
 */
const HEAD = 'abc1234def5678900000000000000000000000000';
const OLD = '0123456789abcdef0000000000000000000000000';
const IMAGE = 'me-west1-docker.pkg.dev/demo/mutaba3a/mutaba3a-api:abc1234d';
const BASE = 'https://me-west1-docker.pkg.dev/v2/demo/mutaba3a/mutaba3a-api';

type Route = Response | ((init?: RequestInit) => Response);
function registry(routes: Record<string, Route>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response(JSON.stringify({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }), { status: 404 });
    return typeof route === 'function' ? route(init) : route.clone();
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const manifest = (configDigest: string) => Response.json({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: configDigest } });
const config = (labels: Record<string, string> | null) => Response.json({ architecture: 'amd64', config: { Labels: labels } });

describe('parseImageRef', () => {
  it('splits host, repository path and tag', () => {
    expect(parseImageRef(IMAGE)).toEqual({ host: 'me-west1-docker.pkg.dev', name: 'demo/mutaba3a/mutaba3a-api', tag: 'abc1234d' });
  });
  it('refuses a reference without a tag', () => {
    expect(() => parseImageRef('me-west1-docker.pkg.dev/demo/mutaba3a/mutaba3a-api')).toThrow(/tag/);
  });
});

describe('imageLabels', () => {
  it('is null when the registry has no such tag', async () => {
    expect(await imageLabels(parseImageRef(IMAGE), 'tok', registry({}).fetchImpl)).toBeNull();
  });

  it('reads the config labels of a single-platform image, with the bearer token', async () => {
    const r = registry({
      [`${BASE}/manifests/abc1234d`]: manifest('sha256:cfg'),
      [`${BASE}/blobs/sha256:cfg`]: config({ [REVISION_LABEL]: HEAD, [DIRTY_LABEL]: 'false' }),
    });
    expect(await imageLabels(parseImageRef(IMAGE), 'tok', r.fetchImpl)).toEqual({ [REVISION_LABEL]: HEAD, [DIRTY_LABEL]: 'false' });
    expect(new Headers(r.calls[0]?.init?.headers).get('authorization')).toBe('Bearer tok');
  });

  it('follows an image index to its linux/amd64 manifest (buildx adds attestations)', async () => {
    const r = registry({
      [`${BASE}/manifests/abc1234d`]: Response.json({
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: [
          { digest: 'sha256:att', platform: { os: 'unknown', architecture: 'unknown' } },
          { digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } },
        ],
      }),
      [`${BASE}/manifests/sha256:amd`]: manifest('sha256:cfg'),
      [`${BASE}/blobs/sha256:cfg`]: config(null),
    });
    expect(await imageLabels(parseImageRef(IMAGE), 'tok', r.fetchImpl)).toEqual({});
  });

  it('throws on an auth or server error rather than read it as "no image"', async () => {
    const r = registry({ [`${BASE}/manifests/abc1234d`]: new Response('denied', { status: 403 }) });
    await expect(imageLabels(parseImageRef(IMAGE), 'tok', r.fetchImpl)).rejects.toThrow(/HTTP 403/);
  });
});

describe('listTags and tagForCommit', () => {
  it('lists every page of tags', async () => {
    const r = registry({
      [`${BASE}/tags/list`]: new Response(JSON.stringify({ tags: ['abc1234d'] }), { headers: { link: '</v2/demo/mutaba3a/mutaba3a-api/tags/list?last=abc1234d&n=1>; rel="next"' } }),
      [`${BASE}/tags/list?last=abc1234d&n=1`]: Response.json({ tags: ['0123456'] }),
    });
    expect(await listTags('me-west1-docker.pkg.dev', 'demo/mutaba3a/mutaba3a-api', 'tok', r.fetchImpl)).toEqual(['abc1234d', '0123456']);
  });

  it('finds the short-sha tag of a commit, the longest when two match', () => {
    expect(tagForCommit(['latest', '0123456', 'abc1234', 'abc1234d', 'abc9'], HEAD)).toBe('abc1234d');
    expect(tagForCommit(['0123456', 'api-v0.8.0'], OLD)).toBe('0123456');
  });

  it('is null when no tag names the commit (never built, or built under an IMAGE_TAG name)', () => {
    expect(tagForCommit(['0123456', 'hotfix'], HEAD)).toBeNull();
    expect(tagForCommit(['abc'], HEAD)).toBeNull(); // too short to be a git short sha
  });
});

describe('deployImagePlan (a normal deploy)', () => {
  const labelled = (revision: string, dirty = 'false') => ({ [REVISION_LABEL]: revision, [DIRTY_LABEL]: dirty });

  it('builds when the tag is free', () => {
    expect(deployImagePlan({ labels: null, tag: 'abc1234d', head: HEAD, treeDirty: false })).toEqual({ action: 'build' });
    expect(deployImagePlan({ labels: null, tag: 'hotfix', head: HEAD, treeDirty: true })).toEqual({ action: 'build' });
  });

  it('reuses the image it already built from this clean HEAD (a re-run after a failed migration)', () => {
    expect(deployImagePlan({ labels: labelled(HEAD), tag: 'abc1234d', head: HEAD, treeDirty: false })).toEqual({ action: 'reuse' });
  });

  it('refuses to push over a tag that names another commit', () => {
    const plan = deployImagePlan({ labels: labelled(OLD), tag: 'hotfix', head: HEAD, treeDirty: false });
    expect(plan).toMatchObject({ action: 'refuse' });
    expect(plan.action === 'refuse' && plan.reason).toMatch(/already names an image built from 0123456789ab.*never pushes over a tag/);
  });

  it('refuses a dirty image or a dirty tree: nothing proves the image holds what is deployed', () => {
    expect(deployImagePlan({ labels: labelled(HEAD, 'true'), tag: 'hotfix', head: HEAD, treeDirty: false })).toMatchObject({ action: 'refuse' });
    expect(deployImagePlan({ labels: labelled(HEAD), tag: 'hotfix', head: HEAD, treeDirty: true })).toMatchObject({ action: 'refuse' });
  });

  it('reuses an unlabelled image only when its tag is HEAD’s short sha and the tree is clean, with a warning', () => {
    expect(deployImagePlan({ labels: {}, tag: 'abc1234d', head: HEAD, treeDirty: false })).toEqual({ action: 'reuse', warning: expect.stringMatching(/no revision label/) });
    expect(deployImagePlan({ labels: {}, tag: 'hotfix', head: HEAD, treeDirty: false })).toMatchObject({ action: 'refuse' });
    expect(deployImagePlan({ labels: {}, tag: 'abc1234d', head: HEAD, treeDirty: true })).toMatchObject({ action: 'refuse' });
  });
});

describe('rollbackImageCheck', () => {
  it('passes an image labelled with the commit, built clean', () => {
    expect(rollbackImageCheck({ labels: { [REVISION_LABEL]: OLD, [DIRTY_LABEL]: 'false' }, commit: OLD })).toEqual({ ok: true });
  });

  it('refuses an image whose label names another commit, or a dirty build', () => {
    expect(rollbackImageCheck({ labels: { [REVISION_LABEL]: HEAD }, commit: OLD })).toMatchObject({ ok: false, reason: expect.stringMatching(/built from abc1234def56/) });
    expect(rollbackImageCheck({ labels: { [REVISION_LABEL]: OLD, [DIRTY_LABEL]: 'true' }, commit: OLD })).toMatchObject({ ok: false, reason: expect.stringMatching(/dirty/) });
  });

  it('warns for an unlabelled image (built before MUT-347): only its tag says which commit it is', () => {
    expect(rollbackImageCheck({ labels: {}, commit: OLD })).toEqual({ ok: true, warning: expect.stringMatching(/no revision label/) });
  });

  it('refuses when the image is gone', () => {
    expect(rollbackImageCheck({ labels: null, commit: OLD })).toMatchObject({ ok: false });
  });
});

describe('the command line', () => {
  const run = async (argv: string[], routes: Record<string, Route>, env: NodeJS.ProcessEnv = { REGISTRY_TOKEN: 'tok' }) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await releaseImageCli(argv, env, { fetchImpl: registry(routes).fetchImpl, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('deploy-plan prints build, or reuse, and refuses with the reason', async () => {
    expect(await run(['deploy-plan', '--image', IMAGE, '--head', HEAD, '--dirty', '0'], {})).toMatchObject({ code: 0, out: 'build' });
    const reused = await run(['deploy-plan', '--image', IMAGE, '--head', HEAD, '--dirty', '0'], {
      [`${BASE}/manifests/abc1234d`]: manifest('sha256:cfg'),
      [`${BASE}/blobs/sha256:cfg`]: config({ [REVISION_LABEL]: HEAD, [DIRTY_LABEL]: 'false' }),
    });
    expect(reused).toMatchObject({ code: 0, out: 'reuse' });
    const refused = await run(['deploy-plan', '--image', IMAGE, '--head', HEAD, '--dirty', '1'], {
      [`${BASE}/manifests/abc1234d`]: manifest('sha256:cfg'),
      [`${BASE}/blobs/sha256:cfg`]: config({ [REVISION_LABEL]: HEAD, [DIRTY_LABEL]: 'false' }),
    });
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/dirty/);
  });

  it('rollback prints the commit’s tag after checking its labels', async () => {
    const r = await run(['rollback', '--repository', 'me-west1-docker.pkg.dev/demo/mutaba3a/mutaba3a-api', '--commit', OLD], {
      [`${BASE}/tags/list`]: Response.json({ tags: ['abc1234d', '0123456'] }),
      [`${BASE}/manifests/0123456`]: manifest('sha256:old'),
      [`${BASE}/blobs/sha256:old`]: config({ [REVISION_LABEL]: OLD, [DIRTY_LABEL]: 'false' }),
    });
    expect(r).toMatchObject({ code: 0, out: '0123456' });
  });

  it('rollback refuses a commit with no image', async () => {
    const r = await run(['rollback', '--repository', 'me-west1-docker.pkg.dev/demo/mutaba3a/mutaba3a-api', '--commit', OLD], {
      [`${BASE}/tags/list`]: Response.json({ tags: ['abc1234d'] }),
    });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no image in .* for 0123456789ab/);
  });

  it('needs REGISTRY_TOKEN', async () => {
    const r = await run(['deploy-plan', '--image', IMAGE, '--head', HEAD, '--dirty', '0'], {}, {});
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/REGISTRY_TOKEN/);
  });
});
