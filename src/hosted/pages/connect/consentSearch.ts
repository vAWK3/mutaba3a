/** MUT-434: `/connect/approve`'s search: a pending request to decide, or an error /oauth/authorize sent here. */
export interface ConsentSearch {
  request?: string;
  error?: string;
}

export function parseConsentSearch(raw: Record<string, unknown>): ConsentSearch {
  const request = typeof raw.request === 'string' ? raw.request : undefined;
  const error = typeof raw.error === 'string' ? raw.error : undefined;
  return { ...(request ? { request } : {}), ...(error ? { error } : {}) };
}

/** Leaving the portal for the agent's redirect. A seam so tests can watch it; production assigns the location. */
export const consentNavigation = {
  assign: (url: string) => window.location.assign(url),
};
