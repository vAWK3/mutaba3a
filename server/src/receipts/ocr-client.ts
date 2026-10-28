import { z } from 'zod';
import type { OcrLine } from './extract/types.js';

/**
 * MUT-441: the API's side of the `receipt-ocr` sidecar (server/ocr). The contract, version 1:
 *
 *   POST ${OCR_URL}/v1/read
 *     body          the receipt's original bytes
 *     Content-Type  the receipt's MIME type
 *     X-Capture-Hint  `scanned` (the phone's Scan, already cleaned) or `photo` (everything else: full preprocessing)
 *     Authorization  `Bearer <Google ID token, audience OCR_URL>` in production; none against a local http sidecar
 *
 *   200  { engine, lines: [{ text, conf 0..1, box [x0, y0, x1, y1], script? }], pdfText?, pages }
 *   422  { error: 'unreadable' }   undecodable, or over the pixel or page caps (terminal, R3)
 *   413  { error: 'too_large' }    (terminal)
 *   504  { error: 'timeout' }      the sidecar's own deadline (worth retrying)
 *
 * R10 #3: every failure, whatever threw it (fetch, JSON.parse, Zod, the extractor), leaves here as an
 * `OcrReadError(code)` with a fixed message and no `cause`, so no receipt text can reach a log line or Sentry.
 */

export const OCR_READ_PATH = '/v1/read';
/** F10: under Cloud Tasks' 60 s dispatch deadline, and the 90 s lease. */
export const OCR_TIMEOUT_MS = 35_000;

export type CaptureHintHeader = 'scanned' | 'photo';

export type OcrReadErrorCode = 'unreadable' | 'too_large' | 'timeout' | 'unavailable' | 'malformed' | 'missing' | 'extract_failed';

/** Codes a retry can't fix: the receipt becomes FAILED at once. The rest leave it PENDING for the next attempt. */
const TERMINAL: ReadonlySet<OcrReadErrorCode> = new Set(['unreadable', 'too_large', 'missing', 'extract_failed']);

const MESSAGES: Record<OcrReadErrorCode, string> = {
  unreadable: 'The OCR service could not read the file',
  too_large: 'The file is over the OCR service limits',
  timeout: 'The OCR service timed out',
  unavailable: 'The OCR service is unavailable',
  malformed: 'The OCR service answered with an unexpected body',
  missing: 'The receipt file is not in storage',
  extract_failed: 'Reading the fields failed',
};

/** A fixed message per code and never a `cause`: nothing a receipt says can ride an error into logs or Sentry. */
export class OcrReadError extends Error {
  readonly code: OcrReadErrorCode;
  constructor(code: OcrReadErrorCode) {
    super(MESSAGES[code]);
    this.name = 'OcrReadError';
    this.code = code;
  }
  get terminal(): boolean {
    return TERMINAL.has(this.code);
  }
}

const OcrLineSchema = z.object({
  text: z.string().max(2_000),
  conf: z.number().min(0).max(1),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  // A script this side doesn't know is simply unknown, not a broken answer.
  script: z.enum(['arab', 'hebr', 'latn']).optional().catch(undefined),
});

export const OcrResultSchema = z.object({
  engine: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
  lines: z.array(OcrLineSchema).max(5_000),
  pdfText: z.string().max(200_000).optional(),
  pages: z.number().int().min(0).max(100),
});
export type OcrResult = { engine: string; lines: OcrLine[]; pdfText?: string | undefined; pages: number };

const OcrRefusalSchema = z.object({ error: z.enum(['unreadable', 'too_large', 'timeout']) });

export interface OcrReadInput {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
  hint: CaptureHintHeader;
}

export interface OcrClient {
  read(input: OcrReadInput): Promise<OcrResult>;
}

export interface HttpOcrClientOptions {
  /** OCR_URL, e.g. https://receipt-ocr-….run.app, or http://localhost:8790 for a local sidecar. */
  baseUrl: string;
  /** Production: a Google ID token for the audience `baseUrl`. Absent: no Authorization header (a local sidecar). */
  authHeaders?: () => Promise<Record<string, string>>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Run `work`; whatever it throws becomes `OcrReadError(code)` (an OcrReadError passes through as it is). */
export async function scrubbed<T>(code: OcrReadErrorCode, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof OcrReadError) throw err;
    throw new OcrReadError(code);
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

export class HttpOcrClient implements OcrClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpOcrClientOptions) {
    this.url = `${options.baseUrl.replace(/\/+$/, '')}${OCR_READ_PATH}`;
    this.timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
    this.fetchFn = options.fetch ?? fetch;
  }

  async read(input: OcrReadInput): Promise<OcrResult> {
    const auth = await scrubbed('unavailable', () => this.options.authHeaders?.() ?? {});
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { 'content-type': input.contentType, 'x-capture-hint': input.hint, ...auth },
        body: input.body,
        signal: AbortSignal.timeout(this.timeoutMs),
        // Node's fetch needs this to send a stream body.
        ...({ duplex: 'half' } as object),
      });
    } catch (err) {
      throw new OcrReadError(isTimeout(err) ? 'timeout' : 'unavailable');
    }
    const text = await scrubbed('unavailable', () => res.text());
    if (res.ok) {
      const body = await scrubbed('malformed', () => JSON.parse(text) as unknown);
      return scrubbed('malformed', () => OcrResultSchema.parse(body) as OcrResult);
    }
    // A refusal names its reason; anything else (a proxy's HTML 503, say) is judged by its status alone.
    const refusal = await scrubbed('unavailable', () => {
      try {
        return OcrRefusalSchema.safeParse(JSON.parse(text));
      } catch {
        return null;
      }
    });
    if (refusal?.success) throw new OcrReadError(refusal.data.error);
    throw new OcrReadError(res.status === 413 ? 'too_large' : res.status === 504 ? 'timeout' : 'unavailable');
  }
}
