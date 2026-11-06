import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from '../api/client';
import { profileKey } from '../session/me';

/**
 * MUT-561 (MUT-314, ADR-248): the owner's "Download a period". The ticket comes from GET /v1/period-downloads/ticket;
 * the file from a form post of that ticket to the stream, so the browser's own downloader saves it (a big zip never
 * passes through page memory, and the ticket never goes in a URL).
 */

export const PERIOD_DOWNLOAD_STREAM = '/v1/period-downloads/stream';

/** Posts `ticket` to the stream from a hidden form. The answer is an attachment, so the page stays where it is. */
export function postDownload(ticket: string, doc: Document = document): void {
  const form = doc.createElement('form');
  form.method = 'POST';
  form.action = PERIOD_DOWNLOAD_STREAM;
  form.hidden = true;
  const field = doc.createElement('input');
  field.type = 'hidden';
  field.name = 'ticket';
  field.value = ticket;
  form.append(field);
  doc.body.append(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
}

/**
 * Whether this server has period downloads on. /v1/me doesn't say, and a real ticket would spend one of the hour's
 * starts, so this asks for a type that doesn't exist: switched off, every period-download route answers 404 before
 * anything reads the request; switched on, validation refuses the type (422) before any ticket is minted.
 */
export async function periodDownloadsOn(profileId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await request<unknown>('GET', '/v1/period-downloads/ticket', { profileId, query: { type: 'none' }, signal });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    if (error instanceof ApiError && (error.status === 422 || error.status === 400)) return true;
    throw error;
  }
}

export function usePeriodDownloadsOn(profileId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'periodDownloadsOn'),
    queryFn: ({ signal }) => periodDownloadsOn(profileId, signal),
    staleTime: Infinity,
    retry: false,
  });
}
