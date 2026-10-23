import Stripe from 'stripe';

/**
 * Stripe's real SDK over a fake `fetch` (MUT-360 R8, shared with MUT-362's checkout gateway): each request is recorded
 * and answered by `respond`, so the tests pin paths, query and form bodies, headers and retries without a network.
 */
export interface SeenRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  /** The form-encoded body of a POST, empty for a GET. */
  form: URLSearchParams;
}

export function fakeStripe(respond: (seen: SeenRequest, call: number) => { status: number; body: unknown; headers?: Record<string, string> }) {
  const seen: SeenRequest[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === 'string' ? init.body : '';
    const request: SeenRequest = { method: init?.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: new Headers(init?.headers), form: new URLSearchParams(body) };
    seen.push(request);
    const { status, body: response, headers } = respond(request, seen.length);
    return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json', 'request-id': `req_${seen.length}`, ...headers } });
  };
  return { seen, httpClient: Stripe.createFetchHttpClient(fakeFetch as typeof fetch) };
}
