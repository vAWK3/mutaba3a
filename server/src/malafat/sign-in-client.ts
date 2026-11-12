import { z } from 'zod';
import type { MalafatSignInFacts } from '../repositories/ports.js';

/**
 * MUT-595 (ADR-254 D1, MAL-1539): MTB3A as a public OAuth client of one Malafat firm's own server, at that firm's
 * origin. PKCE S256 and `state` (ADR-023's pattern); the token is used once for userinfo and revoked straight after:
 * MTB3A keeps nothing of Malafat's. Every call has a deadline; a Malafat that is down answers null, never throws.
 */

export const MALAFAT_SCOPES = 'openid email profile';
/** A firm's slug, as Malafat names its subdomain (R9): the server builds the host itself, never takes one. */
export const MALAFAT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TIMEOUT_MS = 5_000;

export interface MalafatSignInConfig {
  /** `https://{slug}.malafat.app` in production; a locally resolving host in dev. Must contain `{slug}`. */
  originTemplate: string;
  /** MAL-1539: `mtb3a`. */
  clientId: string;
  fetch?: typeof fetch;
}

export function malafatOrigin(config: MalafatSignInConfig, slug: string): string | null {
  return MALAFAT_SLUG.test(slug) ? config.originTemplate.replace('{slug}', slug) : null;
}

const UserinfoSchema = z.object({
  sub: z.string().min(1).max(255),
  tenant_id: z.string().min(1).max(255),
  tenant_slug: z.string().min(1).max(63),
  tenant_name: z.string().min(1).max(200),
  role: z.enum(['PARTNER', 'OFFICE_ADMIN', 'ASSOCIATE', 'INTERN']),
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  name: z.string().max(200).nullable().optional(),
  locale: z.string().max(16).nullable().optional(),
});

const TokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional() });

export class MalafatSignInClient {
  constructor(private readonly config: MalafatSignInConfig) {}

  private get fetch(): typeof fetch {
    return this.config.fetch ?? fetch;
  }

  authorizeUrl(origin: string, params: { redirectUri: string; state: string; codeChallenge: string }): string {
    const url = new URL('/oauth/authorize', origin);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: params.redirectUri,
      scope: MALAFAT_SCOPES,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      state: params.state,
    }).toString();
    return url.toString();
  }

  /** Whether `origin` is a Malafat firm (its discovery document answers): the office preflight (R7). */
  async isOffice(origin: string): Promise<boolean> {
    const res = await this.call(new URL('/.well-known/oauth-authorization-server', origin), { method: 'GET' });
    return res?.ok === true;
  }

  /** Code → the person, the token revoked straight after. Null when Malafat refuses or is unavailable. */
  async signIn(origin: string, input: { code: string; codeVerifier: string; redirectUri: string }): Promise<MalafatSignInFacts | null> {
    const tokenRes = await this.call(new URL('/api/oauth/token', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code, client_id: this.config.clientId, redirect_uri: input.redirectUri, code_verifier: input.codeVerifier }).toString(),
    });
    const tokens = tokenRes?.ok ? TokenSchema.safeParse(await tokenRes.json().catch(() => null)) : null;
    if (!tokens?.success) return null;
    const infoRes = await this.call(new URL('/api/oauth/userinfo', origin), { method: 'GET', headers: { authorization: `Bearer ${tokens.data.access_token}` } });
    const info = infoRes?.ok ? UserinfoSchema.safeParse(await infoRes.json().catch(() => null)) : null;
    // The refresh token is all Malafat would let us keep; MTB3A keeps nothing, so it goes too.
    await this.call(new URL('/api/oauth/revoke', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.data.refresh_token ?? tokens.data.access_token }).toString(),
    });
    if (!info?.success) return null;
    const d = info.data;
    return { subject: d.sub, tenantId: d.tenant_id, tenantSlug: d.tenant_slug, tenantName: d.tenant_name, role: d.role, email: d.email, name: d.name ?? null, locale: d.locale ?? null };
  }

  private async call(url: URL, init: RequestInit): Promise<Response | null> {
    try {
      return await this.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return null;
    }
  }
}
