import { ApiError, apiErrorReason, retryMinutes, type PeriodDownloadTicket, type PeriodDownloadType } from '../api/client';

/**
 * MUT-562 (D7, over MUT-314's routes): a period download. A ticket is minted per file (it says what the period holds,
 * with the receipts zip's size), then posted to the stream by a hidden form, so the browser's own downloader saves the
 * file: nothing in a URL, no Blob in memory. The form targets a hidden frame, so a refused ticket (a JSON 404) never
 * replaces the page. A ticket lives 120 seconds and is spent by its download.
 */

export const STREAM_PATH = '/v1/period-downloads/stream';
const FRAME_NAME = 'mtb3a-period-download';
/** Mint again past this age, well inside the ticket's 120 seconds. */
export const TICKET_FRESH_MS = 90_000;

/** Posts the ticket (and a share link's viewer token) to the stream; the file arrives as an attachment. */
export function submitDownload(ticket: string, viewerToken?: string, doc: Document = document): void {
  let frame = doc.querySelector<HTMLIFrameElement>(`iframe[name="${FRAME_NAME}"]`);
  if (!frame) {
    frame = doc.createElement('iframe');
    frame.name = FRAME_NAME;
    frame.title = FRAME_NAME;
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(frame);
  }
  const form = doc.createElement('form');
  form.method = 'post';
  form.action = STREAM_PATH;
  form.target = FRAME_NAME;
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
  form.submit();
  form.remove();
}

export type DownloadProblem = { kind: 'tooLarge' } | { kind: 'rateLimited'; minutes: number } | { kind: 'unavailable' } | { kind: 'unreachable' };

/** What a refused mint means, in words the person can act on. */
export function downloadProblem(error: unknown): DownloadProblem {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.status === 422 && apiErrorReason(error) === 'PERIOD_TOO_LARGE') return { kind: 'tooLarge' };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  if (error.status === 404) return { kind: 'unavailable' };
  return { kind: 'unreachable' };
}

/** "about 4 MB" from bytes: whole megabytes, at least 1 (or KB under one). */
export function aboutSize(bytes: number, language: 'en' | 'ar'): string {
  const MB = 1024 * 1024;
  const fmt = (n: number) => new Intl.NumberFormat(`${language}-u-nu-latn`).format(n);
  if (bytes < MB) return `${fmt(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${fmt(Math.round(bytes / MB))} MB`;
}

export type Mint = (type: PeriodDownloadType, asOf: string) => Promise<PeriodDownloadTicket>;
