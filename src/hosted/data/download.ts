import { localBackend } from '../api/client';
import { isLocalBlobUrl } from '../session/localBackendContract';

/**
 * Receipt files signed out (MUT-287, brief §6): the bytes behind a
 * `local-blob:` URL live in this browser's IndexedDB, reached through the
 * lazy local backend. An object, so tests can replace `put`/`read` without
 * loading the backend.
 */
export const localFiles = {
  async put(url: string, file: Blob): Promise<void> {
    await (await localBackend()).putBlob(url, file);
  },
  async read(url: string): Promise<Blob | null> {
    return (await localBackend()).readBlob(url);
  },
};

/**
 * How long a download's object URL stays valid. Generous on purpose: Safari
 * (iOS above all, behind its "Download?" prompt) reads the URL only once the
 * person accepts, and a URL revoked before then fails the download.
 */
const OBJECT_URL_RELEASE_MS = 60_000;

/**
 * Saves a Blob as a file named `filename`: a hidden `<a download>` on a
 * temporary object URL, clicked from the document and released later. Never a
 * navigation or a preview (ADR-028). Used by every portal download that has
 * the bytes in hand: local receipts and Your data's records file.
 */
export function saveBlobAs(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_RELEASE_MS);
  }
}

/**
 * Documents and receipts download, never render inside the portal (ADR-028;
 * hosted-portal.md §7.3). Signed in, a top-level navigation to the server's
 * 15-minute signed URL (`Content-Disposition: attachment`). Signed out, a
 * `local-blob:` URL: the stored file goes through a temporary object URL and
 * an `<a download>` named after the file. Rejects when the file can't be
 * read, so the caller shows its toast. An object, so tests can replace `open`
 * without a real navigation.
 */
export const downloadNavigator = {
  async open(url: string, filename: string): Promise<void> {
    if (!isLocalBlobUrl(url)) {
      window.location.assign(url);
      return;
    }
    const blob = await localFiles.read(url);
    if (!blob) throw new Error('This file is no longer on this device');
    saveBlobAs(blob, filename);
  },
};
