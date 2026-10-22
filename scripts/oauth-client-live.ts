/**
 * MUT-387: the Malafat OAuth client document is only as good as what the apex actually serves.
 * Malafat fetches CIMD_CLIENT_ID, refuses any 3xx and anything not served as JSON, and compares
 * `client_id` with the URL byte for byte (cimd-fetcher.ts). `make release web` runs
 * `scripts/check-oauth-client.ts` after the push, which waits for Netlify to serve the document
 * this release published. Pure, so `oauth-client-live.test.ts` can drive every outcome.
 */
import { CIMD_CLIENT_ID } from '../src/services/oauth/oauth-client';

/** What one GET of the document returned, redirects not followed. */
export interface LiveResponse {
  status: number;
  location: string | null;
  contentType: string | null;
  body: string;
}

const STALE = 'differs from public/.well-known/oauth-client.json (the release may not be live yet)';

/** Why Malafat would refuse this answer, or why it isn't the document we published; [] when it's right. */
export function liveDocumentProblems(res: LiveResponse, published: string, clientId: string = CIMD_CLIENT_ID): string[] {
  if (res.status >= 300 && res.status < 400) {
    return [`answers ${res.status} with a redirect to ${res.location ?? '(no location)'} (Malafat refuses any 3xx)`];
  }
  if (res.status !== 200) return [`answers ${res.status}, not 200`];
  const contentType = res.contentType ?? '(none)';
  if (!contentType.toLowerCase().includes('application/json')) {
    return [`is served as ${contentType}, not application/json (Malafat refuses it)`];
  }
  let served: { client_id?: unknown };
  try {
    served = JSON.parse(res.body) as { client_id?: unknown };
  } catch {
    return ['is not valid JSON'];
  }
  const problems: string[] = [];
  if (served.client_id !== clientId) problems.push(`declares client_id ${String(served.client_id)}, not ${clientId}`);
  if (JSON.stringify(served) !== JSON.stringify(JSON.parse(published))) problems.push(STALE);
  return problems;
}

export interface WaitOptions {
  fetchDocument: () => Promise<LiveResponse>;
  published: string;
  clientId?: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How long to wait for the deploy; 0 checks once. */
  timeoutMs: number;
  intervalMs: number;
}

/** Re-checks until the live document is right or the deadline passes; the last problems are the verdict. */
export async function waitForLiveDocument(opts: WaitOptions): Promise<{ problems: string[]; attempts: number }> {
  const deadline = opts.now() + opts.timeoutMs;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    let problems: string[];
    try {
      problems = liveDocumentProblems(await opts.fetchDocument(), opts.published, opts.clientId);
    } catch (error) {
      problems = [`is unreachable: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (problems.length === 0 || opts.now() >= deadline) return { problems, attempts };
    await opts.sleep(Math.min(opts.intervalMs, deadline - opts.now()));
  }
}
