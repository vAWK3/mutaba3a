import { MemoryLedgerStore } from '../../../../../server/src/repositories/memory.js';
import { LocalAttachmentStorage } from '../../attachments.js';
import { IndexedDbBlobStore } from '../../blobStore.js';
import { createLocalApp } from '../../createLocalApp.js';
import { mintLocalSession } from '../../mintLocalSession.js';
import { LOCAL_FORMAT_VERSION } from '../../migrations/index.js';

const NOW = new Date('2026-10-19T09:00:00Z');
export const PDF = '%PDF-1.7 ink receipt';

/** A device with one expense and one READY receipt, built through the real routes. */
export async function deviceWithReceipt() {
  const store = new MemoryLedgerStore();
  const blobs = new IndexedDbBlobStore();
  const app = createLocalApp({ store, now: () => NOW, attachments: new LocalAttachmentStorage(blobs) });
  const { token, user } = await mintLocalSession(store, () => NOW);
  const [membership] = await store.memberships.listByUser(user.id);
  const headers = { Authorization: `Bearer ${token}`, 'X-Mutaba3a-Profile': membership!.organizationId, 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown, key: string) =>
    app.fetch(new Request(`http://local${path}`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(body) }));
  const expense = (await (await post('/v1/expenses', { occurredOn: '2026-10-01', amount: '120.00', currency: 'ILS', title: 'Ink' }, 'helper-expense-1')).json()) as { id: string };
  const started = (await (await post(`/v1/expenses/${expense.id}/receipts`, { filename: 'Ink.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length }, 'helper-receipt-1')).json()) as {
    receipt: { id: string };
    upload: { url: string };
  };
  const key = started.upload.url.slice('local-blob:'.length);
  await blobs.put(key, new Blob([PDF], { type: 'application/pdf' }));
  await post(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, {}, 'helper-complete-1');
  const snapshot = { formatVersion: LOCAL_FORMAT_VERSION, stateVersion: 3, savedAt: NOW, maps: store.snapshot().maps };
  return { store, blobs, key, snapshot };
}

