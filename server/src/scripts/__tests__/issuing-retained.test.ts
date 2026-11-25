import { describe, expect, it } from 'vitest';
import { runRetainedCommand, type RetainedCliDeps } from '../issuing-retained.js';

/** MUT-644: the operator's command over a fake admin API. */
function deps(responses: Record<string, Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const lines: string[] = [];
  const written = new Map<string, Uint8Array>();
  const d: RetainedCliDeps = {
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
      return responses[key] ?? new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no' } }), { status: 404 });
    }) as typeof fetch,
    url: 'http://api.test',
    token: 'token',
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR ${l}`),
    write: async (path, bytes) => void written.set(path, bytes),
  };
  return { d, calls, lines, written };
}

describe('npm run issuing:retained (MUT-644)', () => {
  it('lists closed profiles', async () => {
    const t = deps({ 'GET /admin/v1/issuing/retained': Response.json({ data: [{ organizationId: 'org-1', legalName: 'Kept Ltd.', vatId: '516161616', documents: 2, newestDocumentDate: '2026-11-04', retainedUntil: '2034-01-01' }] }) });
    expect(await runRetainedCommand(['list', '--query', 'kept'], t.d)).toBe(0);
    expect(t.calls[0]!.url).toBe('http://api.test/admin/v1/issuing/retained?query=kept');
    expect(t.lines).toEqual(['org-1  Kept Ltd.  516161616  2 document(s), newest 2026-11-04, kept until 2034-01-01', '1 closed profile(s)']);
  });

  it('writes the archive to --out, sending the reference', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    const t = deps({ 'POST /admin/v1/issuing/retained/org-1/archive': new Response(zip, { status: 200, headers: { 'x-archive-documents': '2' } }) });
    expect(await runRetainedCommand(['archive', '--organization-id', 'org-1', '--reference', 'SUP-7', '--out', '/tmp/a.zip'], t.d)).toBe(0);
    expect(JSON.parse(String(t.calls[0]!.init?.body))).toEqual({ reference: 'SUP-7' });
    expect(t.written.get('/tmp/a.zip')).toEqual(zip);
    expect(t.lines[0]).toMatch(/^2 document\(s\) written to \/tmp\/a.zip/);
  });

  it('says why an archive was refused, and requires its options', async () => {
    const t = deps({ 'POST /admin/v1/issuing/retained/org-1/archive': Response.json({ error: { code: 'CONFLICT', message: 'still exists' } }, { status: 409 }) });
    expect(await runRetainedCommand(['archive', '--organization-id', 'org-1', '--reference', 'SUP-7', '--out', 'a.zip'], t.d)).toBe(1);
    expect(t.lines).toEqual(['ERR archive → 409 CONFLICT: still exists']);
    expect(await runRetainedCommand(['archive', '--organization-id', 'org-1'], t.d)).toBe(1);
    expect(await runRetainedCommand(['nope'], t.d)).toBe(2);
  });

  it('dry-runs the sweep', async () => {
    const t = deps({ 'POST /admin/v1/issuing/retention/sweep': Response.json({ due: 1, swept: 1, failed: 0, incomplete: false, rows: [{ organizationId: 'org-1', outcome: 'would-sweep', documents: 3 }] }) });
    expect(await runRetainedCommand(['sweep', '--dry-run'], t.d)).toBe(0);
    expect(JSON.parse(String(t.calls[0]!.init?.body))).toEqual({ dryRun: true });
    expect(t.lines).toEqual(['would-sweep  org-1  3 document(s)', '1 due. Dry run: 1 would be deleted.']);
  });
});
