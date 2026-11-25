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
    const t = deps({ 'GET /admin/v1/issuing/retained': Response.json({ data: [{ organizationId: 'org-1', legalName: 'Kept Ltd.', vatId: '516161616', documents: 2, nextSweepOn: '2033-11-03', retainedUntil: '2033-11-05' }] }) });
    expect(await runRetainedCommand(['list', '--query', 'kept'], t.d)).toBe(0);
    expect(t.calls[0]!.url).toBe('http://api.test/admin/v1/issuing/retained?query=kept');
    expect(t.lines).toEqual(['org-1  Kept Ltd.  516161616  2 document(s), the first goes 2033-11-03, the last 2033-11-05', '1 closed profile(s)']);
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
    const t = deps({ 'POST /admin/v1/issuing/retention/sweep': Response.json({ due: 1, swept: 1, documentsDeleted: 0, failed: 0, incomplete: false, rows: [{ organizationId: 'org-1', outcome: 'would-sweep', documents: 3, deleted: null, remaining: null }] }) });
    expect(await runRetainedCommand(['sweep', '--dry-run'], t.d)).toBe(0);
    expect(JSON.parse(String(t.calls[0]!.init?.body))).toEqual({ dryRun: true });
    expect(t.lines).toEqual(['would-sweep  org-1  3 document(s) kept', '1 profile(s) with documents due. Dry run: nothing deleted.']);
  });

  it('runs the sweep, one document at a time', async () => {
    const t = deps({ 'POST /admin/v1/issuing/retention/sweep': Response.json({ due: 1, swept: 1, documentsDeleted: 2, failed: 0, incomplete: false, rows: [{ organizationId: 'org-1', outcome: 'swept', documents: 3, deleted: 2, remaining: 1 }] }) });
    expect(await runRetainedCommand(['sweep'], t.d)).toBe(0);
    expect(t.lines).toEqual(['swept  org-1  2 deleted, 1 kept', '1 profile(s) with documents due. Deleted 2 document(s) from 1 profile(s), failed 0.']);
  });

  it('erases with --org and the reference, and says why an erasure was refused', async () => {
    const ok = deps({ 'POST /admin/v1/issuing/retained/org-1/erase': Response.json({ organizationId: 'org-1', documents: 2, cancellations: 0, rows: 9, erasedAt: '2027-03-01T10:00:00.000Z' }) });
    expect(await runRetainedCommand(['erase', '--org', 'org-1', '--reference', 'SUP-8'], ok.d)).toBe(0);
    expect(JSON.parse(String(ok.calls[0]!.init?.body))).toEqual({ reference: 'SUP-8' });
    expect(ok.lines).toEqual(['Erased 2 document(s) (9 row(s) in all). Logged in the retention log.']);

    const refused = deps({ 'POST /admin/v1/issuing/retained/org-1/erase': Response.json({ error: { code: 'CONFLICT', message: 'Export the archive first', details: { reason: 'ARCHIVE_NOT_HANDED_OVER' } } }, { status: 409 }) });
    expect(await runRetainedCommand(['erase', '--organization-id', 'org-1', '--reference', 'SUP-8'], refused.d)).toBe(1);
    expect(refused.lines).toEqual(['ERR erase → 409 ARCHIVE_NOT_HANDED_OVER: Export the archive first']);
    expect(await runRetainedCommand(['erase', '--org', 'org-1'], refused.d)).toBe(1);
  });
});
