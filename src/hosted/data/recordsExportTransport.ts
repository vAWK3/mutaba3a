import { send } from '../api/client';
import type { RecordsExportTransport } from '../session/recordsExportContract';

/**
 * The signed-in Download's two routes (MUT-325), through the portal's `send()`: the session cookie, the profile
 * header, and the portal's ApiError on a refusal (a 429 carries its Retry-After, which the export waits out).
 */
export const recordsExportTransport: RecordsExportTransport = {
  records: (profileId, signal) => send('GET', '/v1/records-export', { profileId, signal }),
  receipt: (profileId, receiptId, signal) =>
    send('GET', `/v1/records-export/receipts/${encodeURIComponent(receiptId)}`, { profileId, signal, accept: 'application/octet-stream' }),
};
