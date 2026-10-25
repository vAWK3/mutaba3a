import { promises as dnsPromises } from 'node:dns';
import { pathToFileURL } from 'node:url';

/**
 * MUT-359 (ADR-159 §5, D4, D21): is Mutaba3a's sending domain ready, and is tracking off?
 *
 *   npm --prefix server run email:check            DNS only, no key: DKIM, the return-path MX and SPF, DMARC.
 *                                                  The release preflight runs this when production.tfvars says
 *                                                  mailer = "resend".
 *   npm --prefix server run email:check -- --api   Also reads the domain through Resend's API: verified, every record
 *                                                  verified, region eu-west-1, open and click tracking off. Needs
 *                                                  RESEND_CHECK_API_KEY, a full-access key the operator keeps in the
 *                                                  Keychain; the server's sending key can't read domains and is never
 *                                                  used here.
 *
 * MAIL_DOMAIN names the sending domain; the npm script fills it from config/hosts.json (`npm run hosts -- get mailDomain`:
 * <mailSubdomain>.<apex>, or the apex). DMARC may sit on it or on a parent domain, as receivers look it up.
 * One `[email] …` line per problem; exit 1 on any.
 */
export const SENDING_REGION = 'eu-west-1';
const RESEND_API = 'https://api.resend.com';
const TIMEOUT_MS = 15_000;

export interface DnsLookup {
  /** TXT records with their chunks joined; [] when there are none. */
  txt(name: string): Promise<string[]>;
  mx(name: string): Promise<{ exchange: string; priority: number }[]>;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  region: string;
  open_tracking?: boolean;
  click_tracking?: boolean;
  records: { record: string; status: string }[];
}

export interface ResendDomainsApi {
  list(): Promise<{ id: string; name: string }[]>;
  get(id: string): Promise<ResendDomain>;
}

const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'ENOTIMP', 'NXDOMAIN']);

export const systemDns: DnsLookup = {
  async txt(name) {
    try {
      return (await dnsPromises.resolveTxt(name)).map((chunks) => chunks.join(''));
    } catch (err) {
      if (NO_RECORD.has((err as { code?: string }).code ?? '')) return [];
      throw err;
    }
  },
  async mx(name) {
    try {
      return await dnsPromises.resolveMx(name);
    } catch (err) {
      if (NO_RECORD.has((err as { code?: string }).code ?? '')) return [];
      throw err;
    }
  },
};

/** The records Resend gives for a domain sending from `region`, as published (frontdoor stack, D1). */
export async function checkEmailDns(domain: string, dns: DnsLookup, region = SENDING_REGION): Promise<string[]> {
  const problems: string[] = [];
  const dkim = await dns.txt(`resend._domainkey.${domain}`);
  if (!dkim.some((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(r))) problems.push(`no DKIM key at resend._domainkey.${domain} (TXT "p=…")`);
  const returnPath = `feedback-smtp.${region}.amazonses.com`;
  const mx = await dns.mx(`send.${domain}`);
  if (mx.length === 0) problems.push(`no return-path MX at send.${domain}`);
  else if (!mx.some((r) => r.exchange.replace(/\.$/, '').toLowerCase() === returnPath)) problems.push(`the return-path MX at send.${domain} isn't ${returnPath} (sending region ${region})`);
  const spf = await dns.txt(`send.${domain}`);
  if (!spf.some((r) => r.startsWith('v=spf1') && r.includes('include:amazonses.com'))) problems.push(`no SPF at send.${domain} (TXT "v=spf1 include:amazonses.com ~all")`);
  if (!(await hasDmarc(domain, dns))) problems.push(`no DMARC record at _dmarc.${domain} or a parent domain (TXT "v=DMARC1; p=none")`);
  return problems;
}

/** DMARC on the domain or, for a mail subdomain, on a parent: the record that governs it (RFC 7489 §6.6.3). */
async function hasDmarc(domain: string, dns: DnsLookup): Promise<boolean> {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    if ((await dns.txt(`_dmarc.${labels.slice(i).join('.')}`)).some((r) => r.startsWith('v=DMARC1'))) return true;
  }
  return false;
}

/** Resend's own view. A tracking field Resend doesn't report counts as on: it must say it is off. */
export async function checkEmailApi(domain: string, api: ResendDomainsApi, region = SENDING_REGION): Promise<string[]> {
  const listed = (await api.list()).find((d) => d.name.toLowerCase() === domain.toLowerCase());
  if (!listed) return [`${domain} is not in Resend: add it (region ${region}) on the Barmajiyat account`];
  const d = await api.get(listed.id);
  const problems: string[] = [];
  if (d.status !== 'verified') problems.push(`${domain} is not verified in Resend (status ${d.status})`);
  if (d.region !== region) problems.push(`${domain} sends from ${d.region}, not ${region}: re-create it in ${region}`);
  for (const r of d.records ?? []) if (r.status !== 'verified') problems.push(`Resend's ${r.record} record for ${domain} is ${r.status}`);
  if (d.open_tracking !== false) problems.push(`open tracking is ${d.open_tracking === true ? 'on' : 'not reported'} for ${domain}: turn it off in Resend`);
  if (d.click_tracking !== false) problems.push(`click tracking is ${d.click_tracking === true ? 'on' : 'not reported'} for ${domain}: turn it off in Resend`);
  return problems;
}

export function createResendDomainsApi(apiKey: string, fetchImpl: typeof fetch = fetch): ResendDomainsApi {
  async function call<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${RESEND_API}${path}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
      throw new Error(`Resend answered ${res.status}${typeof body?.name === 'string' ? ` ${body.name}` : ''} for GET ${path}`);
    }
    return (await res.json()) as T;
  }
  return {
    list: async () => (await call<{ data?: { id: string; name: string }[] }>('/domains')).data?.map(({ id, name }) => ({ id, name })) ?? [],
    get: (id) => call<ResendDomain>(`/domains/${encodeURIComponent(id)}`),
  };
}

export interface EmailCheckIo {
  argv: string[];
  env: NodeJS.ProcessEnv;
  dns: DnsLookup;
  /** Tests pass a stub; otherwise built from RESEND_CHECK_API_KEY. */
  resend?: ResendDomainsApi;
  console: Pick<Console, 'log' | 'error'>;
}

export async function emailCheckMain(io: EmailCheckIo): Promise<number> {
  const domain = io.env.MAIL_DOMAIN?.trim();
  if (!domain || domain === 'null') {
    io.console.error('[email] no domain: set MAIL_DOMAIN, or name one in config/hosts.json (the npm script reads it)');
    return 1;
  }
  const problems = await checkEmailDns(domain, io.dns);
  const withApi = io.argv.includes('--api');
  if (withApi) {
    const key = io.env.RESEND_CHECK_API_KEY;
    const resend = io.resend ?? (key ? createResendDomainsApi(key) : null);
    if (!resend) {
      problems.push('--api needs RESEND_CHECK_API_KEY, a full-access Resend key (Keychain service release-kit, account barmajiyat/RESEND_CHECK_API_KEY); the sending key cannot read domains');
    } else {
      try {
        problems.push(...(await checkEmailApi(domain, resend)));
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  for (const p of problems) io.console.error(`[email] ${p}`);
  if (problems.length > 0) return 1;
  io.console.log(`[email] ok: ${domain} publishes DKIM, the return path (${SENDING_REGION}) and DMARC${withApi ? `, and Resend says verified in ${SENDING_REGION} with tracking off` : ''}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void emailCheckMain({ argv: process.argv.slice(2), env: process.env, dns: systemDns, console })
    .catch((err: unknown) => {
      console.error(`[email] ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    })
    .then((code) => process.exit(code));
}
