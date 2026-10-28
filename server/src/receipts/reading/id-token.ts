import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

/**
 * MUT-441 (F3): service-to-service auth for the OCR service. Cloud Run's metadata server mints a Google ID token for
 * the audience (the OCR service's URL); the client caches and refreshes it. The OCR service admits only the API's
 * service account (`run.invoker`). A local sidecar on http://localhost takes no token (index.ts never builds this then).
 */
export function googleIdTokenHeaders(audience: string): () => Promise<Record<string, string>> {
  const auth = new GoogleAuth();
  let client: Promise<IdTokenClient> | null = null;
  return async () => {
    client ??= auth.getIdTokenClient(audience);
    const authorization = (await (await client).getRequestHeaders()).get('authorization');
    return authorization ? { authorization } : {};
  };
}
