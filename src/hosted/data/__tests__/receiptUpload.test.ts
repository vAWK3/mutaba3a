import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { fail, ok, stubApi } from '../../__tests__/harness';
import { uploadExpenseReceipt } from '../receiptUpload';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * MUT-491 (R1): the expense drawer's uploads share the library's start → PUT → complete steps and its cleanup rule
 * (receiptQueries.test.ts covers the library side): a failed PUT deletes the PENDING row, a refused (4xx) complete
 * deletes it, and a lost answer or a 5xx keeps it, since the receipt may be in.
 */
describe('uploadExpenseReceipt (MUT-491 R1)', () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const E = 'e0000000-0000-4000-8000-000000000001';
  const R = 'b0000000-0000-4000-8000-000000000001';
  const base = `/v1/expenses/${E}/receipts`;
  const started = () => ok({ receipt: { id: R }, upload: { url: `https://storage.googleapis.com/b/${R}`, method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, expiresAt: '2099-01-01T00:00:00Z' } }, 201);
  const file = new File(['%PDF'], 'taxi.pdf', { type: 'application/pdf' });
  const putOk = () => new Response(null, { status: 200 });
  const deleted = () => new Response(null, { status: 204 });

  it('starts on the expense, PUTs the bytes without cookies, completes', async () => {
    const api = stubApi({ [`POST ${base}`]: started, [`PUT /b/${R}`]: putOk, [`POST ${base}/${R}/complete`]: () => ok({ id: R, status: 'READY' }) });
    await expect(uploadExpenseReceipt(P, E, file)).resolves.toMatchObject({ id: R, status: 'READY' });
    expect(api.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([`POST ${base}`, `PUT /b/${R}`, `POST ${base}/${R}/complete`]);
    expect(api.calls[0].body).toEqual({ filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: 4 });
    expect(api.fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit' });
  });

  it('a failed PUT deletes the PENDING row, then throws', async () => {
    const api = stubApi({ [`POST ${base}`]: started, [`PUT /b/${R}`]: () => new Response(null, { status: 403 }), [`DELETE ${base}/${R}`]: deleted });
    await expect(uploadExpenseReceipt(P, E, file)).rejects.toBeInstanceOf(ApiError);
    expect(api.count(`DELETE ${base}/${R}`)).toBe(1);
  });

  it('a refused complete deletes; a failed delete still throws the original error', async () => {
    const api = stubApi({ [`POST ${base}`]: started, [`PUT /b/${R}`]: putOk, [`POST ${base}/${R}/complete`]: () => fail(422, 'VALIDATION_FAILED', { reason: 'UPLOAD_MISMATCH' }), [`DELETE ${base}/${R}`]: () => fail(500, 'INTERNAL') });
    await expect(uploadExpenseReceipt(P, E, file)).rejects.toMatchObject({ status: 422 });
    expect(api.count(`DELETE ${base}/${R}`)).toBe(1);
  });

  it('a complete whose answer was lost keeps the receipt (it may be in)', async () => {
    const api = stubApi({ [`POST ${base}`]: started, [`PUT /b/${R}`]: putOk, [`POST ${base}/${R}/complete`]: () => fail(502, 'UNKNOWN') });
    await expect(uploadExpenseReceipt(P, E, file)).rejects.toMatchObject({ status: 502 });
    expect(api.count(`DELETE ${base}/${R}`)).toBe(0);
  });

  it('a refused start leaves nothing to delete', async () => {
    const api = stubApi({ [`POST ${base}`]: () => fail(422, 'VALIDATION_FAILED', { reason: 'TOO_MANY_RECEIPTS' }) });
    await expect(uploadExpenseReceipt(P, E, file)).rejects.toMatchObject({ status: 422 });
    expect(api.calls).toHaveLength(1);
  });
});
