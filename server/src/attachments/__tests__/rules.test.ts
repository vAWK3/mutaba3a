import { describe, expect, it } from 'vitest';
import { checkUpload, contentDisposition, MAX_ATTACHMENT_BYTES, storageKey } from '../rules.js';

describe('attachment rules', () => {
  const base = { mimeType: 'application/pdf', sizeBytes: 1024, filename: 'INV-2026-117.pdf', paymentId: 'pay1' };

  it('accepts pdf / jpeg / png up to 10 MB with exactly one target', () => {
    expect(checkUpload(base)).toEqual({ ok: true, target: { paymentId: 'pay1' } });
    expect(checkUpload({ ...base, mimeType: 'image/jpeg', paymentId: undefined, customerId: 'c1' })).toEqual({ ok: true, target: { customerId: 'c1' } });
    expect(checkUpload({ ...base, mimeType: 'image/png', sizeBytes: MAX_ATTACHMENT_BYTES, paymentId: undefined, projectId: 'p1' })).toEqual({ ok: true, target: { projectId: 'p1' } });
  });

  it('refuses other types, oversized or empty files, bad filenames, no target, two targets', () => {
    expect(checkUpload({ ...base, mimeType: 'application/zip' })).toEqual({ ok: false, reason: 'MIME_TYPE_UNSUPPORTED' });
    expect(checkUpload({ ...base, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })).toEqual({ ok: false, reason: 'FILE_TOO_LARGE' });
    expect(checkUpload({ ...base, sizeBytes: 0 })).toEqual({ ok: false, reason: 'FILE_TOO_LARGE' });
    expect(checkUpload({ ...base, filename: '../etc/passwd' })).toEqual({ ok: false, reason: 'FILENAME_INVALID' });
    expect(checkUpload({ ...base, filename: '  ' })).toEqual({ ok: false, reason: 'FILENAME_INVALID' });
    expect(checkUpload({ ...base, paymentId: undefined })).toEqual({ ok: false, reason: 'ATTACHMENT_TARGET_REQUIRED' });
    expect(checkUpload({ ...base, customerId: 'c1' })).toEqual({ ok: false, reason: 'ATTACHMENT_TARGET_AMBIGUOUS' });
  });

  it('storage keys are ids only; the download disposition escapes the filename', () => {
    expect(storageKey('org1', 'att1')).toBe('org/org1/att1');
    expect(storageKey('org1', 'att1')).not.toContain('.pdf');
    expect(contentDisposition('فاتورة "A".pdf')).toBe(`attachment; filename="______ _A_.pdf"; filename*=UTF-8''${encodeURIComponent('فاتورة "A".pdf')}`);
  });
});
