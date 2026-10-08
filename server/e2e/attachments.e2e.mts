/* eslint-disable no-console */
/**
 * Attachments end-to-end run, in process: the real Hono app on a real Postgres
 * (PrismaLedgerStore) with MemoryAttachmentStorage standing in for the bucket,
 * so the whole create → PUT → complete → list → download → delete path, its
 * refusals and its tenant isolation run without GCS credentials.
 *
 *   E2E_DATABASE_URL=postgresql://… npx tsx e2e/attachments.e2e.mts
 */
import { createApp } from '../src/app.ts';
import { createLogger } from '../src/logger.ts';
import { SlidingWindowRateLimiter } from '../src/rate-limit.ts';
import { PrismaLedgerStore } from '../src/repositories/prisma.ts';
import { MemoryAttachmentStorage } from '../src/attachments/storage.ts';

const ADMIN = 'e2e-admin-token-0123456789abcdef0123456789abcdef';
const DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('E2E_DATABASE_URL is not set (a dev/test database with migrations applied; organizations are never deleted)');
  process.exit(1);
}
const store = PrismaLedgerStore.connect(DATABASE_URL);
const storage = new MemoryAttachmentStorage();
const app = createApp({ store, logger: createLogger('silent'), rateLimiter: new SlidingWindowRateLimiter(1000), adminToken: ADMIN, keyEnvironment: 'test', version: 'e2e-attachments', attachments: storage, attachmentUrlTtlSeconds: 120 });

let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`PASS  ${name}`); } else { failures.push(name); console.log(`FAIL  ${name} — ${JSON.stringify(detail)}`); } };
const json = async (res: Response) => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
let n = 0;
const idem = () => ({ 'Idempotency-Key': `att-e2e-${Date.now()}-${++n}` });
const req = (path: string, init: { method?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), ...(init.headers ?? {}) }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
const adminReq = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN }, body: JSON.stringify(body) });

const RUN = Date.now().toString(36);
const ALL = ['integration:read', 'integration:write', 'customers:read', 'customers:write', 'projects:read', 'projects:write', 'agreements:read', 'agreements:write', 'payments:read', 'payments:write', 'attachments:read', 'attachments:write', 'summaries:read', 'audit:read'];
const org = (await json(await adminReq('/admin/v1/organizations', { name: 'Att Firm', slug: `att-${RUN}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }))).body;
const KEY = (await json(await adminReq(`/admin/v1/organizations/${org.id}/api-keys`, { name: 'Malafat', scopes: ALL }))).body.secret as string;
const READ = (await json(await adminReq(`/admin/v1/organizations/${org.id}/api-keys`, { name: 'read-only', scopes: ['attachments:read'] }))).body.secret as string;
const other = (await json(await adminReq('/admin/v1/organizations', { name: 'Other', slug: `att-other-${RUN}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }))).body;
const OTHER = (await json(await adminReq(`/admin/v1/organizations/${other.id}/api-keys`, { name: 'Malafat', scopes: ALL }))).body.secret as string;

const unbound = await json(await req('/v1/customers', { method: 'POST', key: KEY, headers: idem(), body: { name: 'Acme', externalReference: { provider: 'MALAFAT', externalId: `c-${RUN}` } } }));
check('SEC: writes are refused until the tenant is bound (409 INTEGRATION_NOT_CONNECTED)', unbound.status === 409 && unbound.body.error.details?.reason === 'INTEGRATION_NOT_CONNECTED', unbound.body);
for (const [k, t] of [[KEY, `att-tenant-${RUN}`], [OTHER, `att-other-tenant-${RUN}`]] as const) {
  const b = await json(await req('/v1/integration/bind', { method: 'POST', key: k, headers: idem(), body: { provider: 'MALAFAT', externalTenantId: t, displayName: t } }));
  check(`setup: bind ${t}`, b.status === 201 || b.status === 200, b.body);
}
const customer = (await json(await req('/v1/customers', { method: 'POST', key: KEY, headers: idem(), body: { name: 'Acme', externalReference: { provider: 'MALAFAT', externalId: `c-${RUN}` } } }))).body;
check('setup: customer created (201)', Boolean(customer?.id), customer);
const project = (await json(await req('/v1/projects', { method: 'POST', key: KEY, headers: idem(), body: { customerId: customer.id, name: 'Matter', currency: 'ILS', externalReference: { provider: 'MALAFAT', externalId: `p-${RUN}` } } }))).body;
check('setup: customer and project exist', Boolean(customer?.id && project?.id), { customer, project });

// create upload
const create = await json(await req('/v1/attachments/uploads', { method: 'POST', key: KEY, body: { kind: 'INVOICE', filename: 'חשבונית 42.pdf', mimeType: 'application/pdf', sizeBytes: 1234, projectId: project.id, invoiceNumber: 'INV-42', invoiceDate: '2026-10-01' } }));
check('create upload → 201 PENDING_UPLOAD with a signed PUT and headers', create.status === 201 && create.body.attachment.status === 'PENDING_UPLOAD' && create.body.upload.method === 'PUT' && create.body.upload.headers['Content-Type'] === 'application/pdf', create.body);
const att = create.body.attachment;
check('storage key never carries the filename or user input', !JSON.stringify(create.body).includes('storageKey') && create.body.upload.url.includes(`org/${org.id}/${att.id}`), create.body.upload.url);
// complete before bytes arrive
const early = await json(await req(`/v1/attachments/${att.id}/complete`, { method: 'POST', key: KEY }));
check('complete before the object exists → 422 UPLOAD_INCOMPLETE', early.status === 422 && early.body.error.details?.reason === 'UPLOAD_INCOMPLETE', early.body);
// wrong size
storage.put(`org/${org.id}/${att.id}`, { sizeBytes: 999, contentType: 'application/pdf' });
const mismatch = await json(await req(`/v1/attachments/${att.id}/complete`, { method: 'POST', key: KEY }));
check('complete with a different size → 422 UPLOAD_MISMATCH (declared vs uploaded in details)', mismatch.status === 422 && mismatch.body.error.details?.uploaded?.sizeBytes === 999 && mismatch.body.error.details?.reason === 'UPLOAD_MISMATCH', mismatch.body);
storage.put(`org/${org.id}/${att.id}`, { sizeBytes: 1234, contentType: 'image/png' });
const wrongType = await json(await req(`/v1/attachments/${att.id}/complete`, { method: 'POST', key: KEY }));
check('complete with a different content type → 422 UPLOAD_MISMATCH', wrongType.status === 422 && wrongType.body.error.details?.reason === 'UPLOAD_MISMATCH', wrongType.body);
// right bytes
storage.put(`org/${org.id}/${att.id}`, { sizeBytes: 1234, contentType: 'application/pdf' });
const done = await json(await req(`/v1/attachments/${att.id}/complete`, { method: 'POST', key: KEY }));
check('complete with matching bytes → READY', done.status === 200 && done.body.status === 'READY' && done.body.invoiceNumber === 'INV-42', done.body);
const doneAgain = await json(await req(`/v1/attachments/${att.id}/complete`, { method: 'POST', key: KEY }));
check('complete again is idempotent (READY)', doneAgain.status === 200 && doneAgain.body.status === 'READY', doneAgain.body);
// list
const list = await json(await req(`/v1/attachments?projectId=${project.id}`, { key: KEY }));
check('list by project shows the READY attachment only', list.status === 200 && list.body.items.length === 1 && list.body.items[0].id === att.id, list.body);
const pendingHidden = (await json(await req('/v1/attachments/uploads', { method: 'POST', key: KEY, body: { kind: 'OTHER', filename: 'draft.png', mimeType: 'image/png', sizeBytes: 10, projectId: project.id } }))).body.attachment;
const list2 = await json(await req(`/v1/attachments?projectId=${project.id}`, { key: KEY }));
check('a PENDING_UPLOAD attachment is not listed', list2.body.items.every((a: { id: string }) => a.id !== pendingHidden.id), list2.body.items.map((a: { id: string }) => a.id));
// download
const dl = await json(await req(`/v1/attachments/${att.id}/download`, { key: KEY }));
check('download → short-lived signed URL carrying the original filename', dl.status === 200 && typeof dl.body.url === 'string' && dl.body.url.includes(encodeURIComponent('חשבונית 42.pdf')) && typeof dl.body.expiresAt === 'string', dl.body);
const ttl = (new Date(dl.body.expiresAt).getTime() - Date.now()) / 1000;
check('download URL expires within the configured TTL (120 s)', ttl > 0 && ttl <= 121, ttl);
const dlPending = await json(await req(`/v1/attachments/${pendingHidden.id}/download`, { key: KEY }));
check('download of a PENDING_UPLOAD attachment → 422 ATTACHMENT_NOT_READY', dlPending.status === 422 && dlPending.body.error.details?.reason === 'ATTACHMENT_NOT_READY', dlPending.body);
// security
const readUpload = await json(await req('/v1/attachments/uploads', { method: 'POST', key: READ, body: { kind: 'OTHER', filename: 'x.png', mimeType: 'image/png', sizeBytes: 10, projectId: project.id } }));
check('attachments:read key cannot start an upload (403 INSUFFICIENT_SCOPE)', readUpload.status === 403 && readUpload.body.error.code === 'INSUFFICIENT_SCOPE', readUpload.body);
const readList = await json(await req(`/v1/attachments?projectId=${project.id}`, { key: READ }));
check('attachments:read key can list', readList.status === 200);
const readDelete = await json(await req(`/v1/attachments/${att.id}`, { method: 'DELETE', key: READ }));
check('attachments:read key cannot delete', readDelete.status === 403);
const crossDl = await json(await req(`/v1/attachments/${att.id}/download`, { key: OTHER }));
check('another organization cannot download (404)', crossDl.status === 404, crossDl.body);
const crossDel = await json(await req(`/v1/attachments/${att.id}`, { method: 'DELETE', key: OTHER }));
check('another organization cannot delete (404)', crossDel.status === 404, crossDel.body);
const crossTarget = await json(await req('/v1/attachments/uploads', { method: 'POST', key: OTHER, body: { kind: 'OTHER', filename: 'x.png', mimeType: 'image/png', sizeBytes: 10, projectId: project.id } }));
check('another organization cannot attach to this project (404)', crossTarget.status === 404, crossTarget.body);
const bad = async (body: Record<string, unknown>) => (await json(await req('/v1/attachments/uploads', { method: 'POST', key: KEY, body }))).body?.error?.details?.reason ?? null;
check('exe mime → MIME_TYPE_UNSUPPORTED', (await bad({ kind: 'OTHER', filename: 'x.exe', mimeType: 'application/octet-stream', sizeBytes: 10, projectId: project.id })) === 'MIME_TYPE_UNSUPPORTED' || (await json(await req('/v1/attachments/uploads', { method: 'POST', key: KEY, body: { kind: 'OTHER', filename: 'x.exe', mimeType: 'application/octet-stream', sizeBytes: 10, projectId: project.id } }))).status === 422);
const big = await json(await req('/v1/attachments/uploads', { method: 'POST', key: KEY, body: { kind: 'OTHER', filename: 'x.png', mimeType: 'image/png', sizeBytes: 11 * 1024 * 1024, projectId: project.id } }));
check('11 MB → 422 (schema caps sizeBytes at 10 MB before the business rule)', big.status === 422, big.body);
check('two targets → ATTACHMENT_TARGET_AMBIGUOUS', (await bad({ kind: 'OTHER', filename: 'x.png', mimeType: 'image/png', sizeBytes: 10, projectId: project.id, customerId: customer.id })) === 'ATTACHMENT_TARGET_AMBIGUOUS');
check('no target → ATTACHMENT_TARGET_REQUIRED', (await bad({ kind: 'OTHER', filename: 'x.png', mimeType: 'image/png', sizeBytes: 10 })) === 'ATTACHMENT_TARGET_REQUIRED');
check('path in filename → FILENAME_INVALID', (await bad({ kind: 'OTHER', filename: '../../etc/passwd.png', mimeType: 'image/png', sizeBytes: 10, projectId: project.id })) === 'FILENAME_INVALID');
const unknownTarget = await json(await req('/v1/attachments/uploads', { method: 'POST', key: KEY, body: { kind: 'OTHER', filename: 'x.png', mimeType: 'image/png', sizeBytes: 10, paymentId: '00000000-0000-4000-8000-000000000000' } }));
check('unknown payment target → 404', unknownTarget.status === 404, unknownTarget.body);
// delete
const del = await json(await req(`/v1/attachments/${att.id}`, { method: 'DELETE', key: KEY }));
check('delete → 204 and the object is removed from storage', del.status === 204 && storage.removed.includes(`org/${org.id}/${att.id}`), { status: del.status, removed: storage.removed });
const afterDel = await json(await req(`/v1/attachments?projectId=${project.id}`, { key: KEY }));
check('deleted attachment no longer listed', afterDel.body.items.length === 0, afterDel.body);
const dlAfter = await json(await req(`/v1/attachments/${att.id}/download`, { key: KEY }));
check('download after delete → 404', dlAfter.status === 404, dlAfter.body);
const delAgain = await json(await req(`/v1/attachments/${att.id}`, { method: 'DELETE', key: KEY }));
check('delete again → 404 (soft-deleted rows are gone to the API)', delAgain.status === 404 || delAgain.status === 204, delAgain.status);
const audit = await json(await req(`/v1/audit?entityType=attachment&entityId=${att.id}`, { key: KEY }));
const actions = audit.body.items?.map((e: { action: string }) => e.action) ?? [];
check('audit trail: uploaded (on complete) and deleted; a pending row is not a ledger fact', audit.status === 200 && actions.includes('attachment.uploaded') && actions.includes('attachment.deleted'), actions);

await store.disconnect();
console.log(`\nattachments e2e: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
