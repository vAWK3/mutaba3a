import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { fail, ok, stubApi } from '../../__tests__/harness';
import { checkReceiptFile, MAX_RECEIPT_BYTES } from '../receiptFileRules';
import { filingStatusOf, isLibraryOff, nextReceiptId, uploadErrorOf } from '../receiptQueries';
import { uploadLibraryReceipt } from '../receiptUpload';

/** MUT-260: the receipts library's pure rules and the upload sequence. */

afterEach(() => vi.unstubAllGlobals());

describe('checkReceiptFile (A5)', () => {
  const file = (over: Partial<{ type: string; size: number; name: string }> = {}) => ({ type: 'image/png', size: 10, name: 'r.png', ...over });
  it('takes PDF, JPEG and PNG up to 10 MB with a usable name', () => {
    expect(checkReceiptFile(file())).toBeNull();
    expect(checkReceiptFile(file({ type: 'application/pdf', size: MAX_RECEIPT_BYTES }))).toBeNull();
  });
  it('refuses the type, then the size, then the name, as the server does', () => {
    expect(checkReceiptFile(file({ type: 'image/gif' }))).toBe('invalidType');
    expect(checkReceiptFile(file({ size: MAX_RECEIPT_BYTES + 1 }))).toBe('tooLarge');
    expect(checkReceiptFile(file({ size: 0 }))).toBe('empty');
    expect(checkReceiptFile(file({ name: 'a/b.png' }))).toBe('badName');
    expect(checkReceiptFile(file({ name: 'x'.repeat(201) }))).toBe('badName');
    expect(checkReceiptFile(file({ name: 'a\u0007.png' }))).toBe('badName');
    expect(checkReceiptFile(file({ name: '   ' }))).toBe('badName');
  });
});

describe('the gallery filter and the queue (A13)', () => {
  it('maps the URL status to filingStatus; all sends none', () => {
    expect(filingStatusOf('to_review')).toBe('TO_REVIEW');
    expect(filingStatusOf('filed')).toBe('FILED');
    expect(filingStatusOf('all')).toBeUndefined();
  });
  it('next is the one after, else the first other one, else none', () => {
    const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(nextReceiptId(q, 'a')).toBe('b');
    expect(nextReceiptId(q, 'c')).toBe('a');
    expect(nextReceiptId(q, 'x')).toBe('a');
    expect(nextReceiptId([{ id: 'a' }], 'a')).toBeNull();
    expect(nextReceiptId(undefined, 'a')).toBeNull();
  });
});

describe('errors', () => {
  it('404 and 503 mean the library is off (A11); nothing else does', () => {
    expect(isLibraryOff(new ApiError(404, 'NOT_FOUND', 'm'))).toBe(true);
    expect(isLibraryOff(new ApiError(503, 'ATTACHMENTS_NOT_CONFIGURED', 'm'))).toBe(true);
    expect(isLibraryOff(new ApiError(500, 'INTERNAL', 'm'))).toBe(false);
    expect(isLibraryOff(new ApiError(0, 'NETWORK', 'm'))).toBe(false);
  });
  it('tells the two 429s apart (A4), the bucket being down, and anything else', () => {
    expect(uploadErrorOf(new ApiError(429, 'RATE_LIMITED', 'm', { reason: 'TOO_MANY_PENDING_UPLOADS' }))).toEqual({ key: 'tooManyPending' });
    expect(uploadErrorOf(new ApiError(429, 'RATE_LIMITED', 'm', { retryAfterSeconds: 12 }, null, 12))).toEqual({ key: 'rateLimited', seconds: 12 });
    expect(uploadErrorOf(new ApiError(429, 'RATE_LIMITED', 'm'))).toEqual({ key: 'rateLimited', seconds: 60 });
    expect(uploadErrorOf(new ApiError(503, 'ATTACHMENTS_NOT_CONFIGURED', 'm'))).toEqual({ key: 'storage' });
    expect(uploadErrorOf(new Error('x'))).toEqual({ key: 'uploadFailed' });
  });
});

describe('uploadLibraryReceipt (D9, A4)', () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const R = 'b0000000-0000-4000-8000-000000000001';
  const started = () => ok({ receipt: { id: R }, upload: { url: `https://storage.googleapis.com/b/${R}`, method: 'PUT', headers: { 'Content-Type': 'image/png' }, expiresAt: '2099-01-01T00:00:00Z' } }, 201);
  const file = new File(['png'], 'r.png', { type: 'image/png' });

  it('starts with the key, PUTs the bytes without cookies, completes', async () => {
    const api = stubApi({ 'POST /v1/receipts/uploads': started, [`PUT /b/${R}`]: () => new Response(null, { status: 200 }), [`POST /v1/receipts/${R}/complete`]: () => ok({ id: R, status: 'READY' }) });
    await expect(uploadLibraryReceipt(P, file, 'key-1')).resolves.toMatchObject({ id: R, status: 'READY' });
    expect(api.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['POST /v1/receipts/uploads', `PUT /b/${R}`, `POST /v1/receipts/${R}/complete`]);
    expect(api.calls[0].headers.get('Idempotency-Key')).toBe('key-1');
    expect(api.fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit' });
  });

  it('a failed PUT deletes the PENDING row, then throws', async () => {
    const api = stubApi({ 'POST /v1/receipts/uploads': started, [`PUT /b/${R}`]: () => new Response(null, { status: 403 }), [`DELETE /v1/receipts/${R}`]: () => new Response(null, { status: 204 }) });
    await expect(uploadLibraryReceipt(P, file, 'key-1')).rejects.toBeInstanceOf(ApiError);
    expect(api.count(`DELETE /v1/receipts/${R}`)).toBe(1);
  });

  it('a complete whose answer was lost keeps the receipt (it may be in)', async () => {
    const api = stubApi({ 'POST /v1/receipts/uploads': started, [`PUT /b/${R}`]: () => new Response(null, { status: 200 }), [`POST /v1/receipts/${R}/complete`]: () => fail(502, 'UNKNOWN') });
    await expect(uploadLibraryReceipt(P, file, 'key-1')).rejects.toMatchObject({ status: 502 });
    expect(api.count(`DELETE /v1/receipts/${R}`)).toBe(0);
  });

  it('a refused complete deletes; a failed delete still throws the original error', async () => {
    const api = stubApi({ 'POST /v1/receipts/uploads': started, [`PUT /b/${R}`]: () => new Response(null, { status: 200 }), [`POST /v1/receipts/${R}/complete`]: () => fail(422, 'VALIDATION_FAILED', { reason: 'UPLOAD_MISMATCH' }), [`DELETE /v1/receipts/${R}`]: () => fail(500, 'INTERNAL') });
    await expect(uploadLibraryReceipt(P, file, 'key-1')).rejects.toMatchObject({ status: 422 });
    expect(api.count(`DELETE /v1/receipts/${R}`)).toBe(1);
  });

  it('a refused start leaves nothing to delete', async () => {
    const api = stubApi({ 'POST /v1/receipts/uploads': () => fail(429, 'RATE_LIMITED', { reason: 'TOO_MANY_PENDING_UPLOADS' }) });
    await expect(uploadLibraryReceipt(P, file, 'key-1')).rejects.toMatchObject({ status: 429 });
    expect(api.calls).toHaveLength(1);
  });
});
