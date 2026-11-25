import { useQuery } from '@tanstack/react-query';
import { ApiError, apiErrorReason, request, retryMinutes, type PeriodDownloadTicket, type PeriodDownloadType } from '../api/client';
import { profileKey } from '../session/me';
import { getLocale } from '../../lib/i18n/core';

/**
 * MUT-562 (D7, over MUT-314's routes): a period download. A ticket is minted per file (it says what the period holds,
 * with the receipts zip's size), then posted to the stream by a form, so the browser's own downloader saves the file:
 * nothing in a URL, no Blob in memory. One module for every period download: the owner's (MUT-561's Sharing page), an
 * accountant's client book and a share link's page (MUT-562).
 *
 * Review fix 6: the form is top level (`target="_self"`), not a hidden frame. The API sends the portal's CSP, with
 * `frame-ancestors 'none'`, on every response, the stream included (server/src/app.ts PORTAL_CSP), so a framed download
 * can be blocked. An attachment answer leaves the page where it is. Review fix 5: a press always mints a fresh ticket
 * just before posting it (`PeriodDownloads`), so an expired or spent ticket is never posted; what's left (access
 * revoked in that second) answers the stream's JSON 404. Server note: answering a refused *form* post with a redirect
 * back to the page would close that last gap.
 */

export const STREAM_PATH = '/v1/period-downloads/stream';
/** Past this, the panel's `asOf` (at most 24 hours back on the server) is taken again. */
export const AS_OF_REFRESH_MS = 20 * 60 * 60 * 1000;

/** Posts the ticket (and a share link's viewer token) to the stream; the file arrives as an attachment. */
export function submitDownload(ticket: string, viewerToken?: string, doc: Document = document): void {
  const form = doc.createElement('form');
  form.method = 'post';
  form.action = STREAM_PATH;
  form.target = '_self';
  form.hidden = true;
  const fields: [string, string][] = [['ticket', ticket], ...(viewerToken ? ([['viewerToken', viewerToken]] as [string, string][]) : [])];
  for (const [name, value] of fields) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  doc.body.appendChild(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
}

export type DownloadProblem = { kind: 'asOf' } | { kind: 'tooLarge' } | { kind: 'rateLimited'; minutes: number } | { kind: 'unavailable' } | { kind: 'unreachable' };

/** What a refused mint means, in words the person can act on. */
export function downloadProblem(error: unknown): DownloadProblem {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.status === 422 && apiErrorReason(error) === 'PERIOD_TOO_LARGE') return { kind: 'tooLarge' };
  // The panel's asOf is too old for the server (more than 24 hours back): mint again with a new one
  if (error.status === 422 && apiErrorReason(error) === 'AS_OF') return { kind: 'asOf' };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  if (error.status === 404) return { kind: 'unavailable' };
  return { kind: 'unreachable' };
}

/** "about 4 MB" from bytes: whole megabytes, at least 1 (or KB under one). */
export function aboutSize(bytes: number, language: 'en' | 'ar'): string {
  const MB = 1024 * 1024;
  const fmt = (n: number) => new Intl.NumberFormat(getLocale(language)).format(n);
  if (bytes < MB) return `${fmt(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${fmt(Math.round(bytes / MB))} MB`;
}

export type Mint = (type: PeriodDownloadType, asOf: string) => Promise<PeriodDownloadTicket>;

/** MUT-561's name for the stream. */
export const PERIOD_DOWNLOAD_STREAM = STREAM_PATH;

/** MUT-561's owner download: the ticket alone (no viewer token). */
export function postDownload(ticket: string, doc: Document = document): void {
  submitDownload(ticket, undefined, doc);
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
