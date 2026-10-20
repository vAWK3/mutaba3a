import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadNavigator, localFiles } from '../download';

/**
 * MUT-287 (brief §6, ADR-028): a receipt saved on this device downloads from
 * its `local-blob:` URL as a file with its own name, through a temporary
 * object URL and `<a download>`; never a preview, never a navigation.
 */
describe('downloadNavigator, local-blob URLs', () => {
  const originalRead = localFiles.read;
  const createObjectURL = vi.fn(() => 'blob:http://portal.test/abc');
  const revokeObjectURL = vi.fn();
  let clicked: Array<{ href: string; download: string; connected: boolean }>;

  beforeEach(() => {
    clicked = [];
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download, connected: this.isConnected });
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    localFiles.read = originalRead;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves the stored file under its name, then releases the object URL', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    localFiles.read = vi.fn(async () => blob);

    await downloadNavigator.open('local-blob:org/o1/expense-receipts/r1', 'Ink receipt.pdf');

    expect(localFiles.read).toHaveBeenCalledWith('local-blob:org/o1/expense-receipts/r1');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:http://portal.test/abc', download: 'Ink receipt.pdf', connected: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://portal.test/abc');
  });

  it('fails when this device no longer has the file, so the caller shows its toast', async () => {
    localFiles.read = vi.fn(async () => null);

    await expect(downloadNavigator.open('local-blob:gone', 'Ink receipt.pdf')).rejects.toThrow();
    expect(clicked).toEqual([]);
  });
});
