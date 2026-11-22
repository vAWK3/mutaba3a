import { registryOf } from './tax-id.js';

/**
 * MUT-642: who a company or nonprofit number belongs to, from Israel's public registries on data.gov.il (CKAN
 * `datastore_search`, open data, no key): the Registrar of Companies' companies file and the nonprofits registry. A sole
 * dealer's number is in neither (no public lookup), so it is "not found" and the person types the name.
 */
export interface RegistryEntry {
  kind: 'company' | 'nonprofit';
  name: string;
  nameEn: string | null;
  status: string;
  /** False for a dissolved, struck-off or deleted body: the portal warns before it's invoiced. */
  active: boolean;
  address: string | null;
}

export type RegistryLookupResult = { kind: 'found'; entry: RegistryEntry } | { kind: 'not_found' } | { kind: 'unavailable' };

export interface RegistryConfig {
  baseUrl: string;
  companiesResource: string;
  nonprofitsResource: string;
  timeoutMs: number;
  ttlMs: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const COMPANY_NUMBER = 'מספר חברה';
const NONPROFIT_NUMBER = 'מספר עמותה';
const CACHE_LIMIT = 1000;

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function companyEntry(r: Row): RegistryEntry {
  const street = [text(r['שם רחוב']), text(r['מספר בית'])].filter(Boolean).join(' ');
  const status = text(r['סטטוס חברה']) ?? '';
  return {
    kind: 'company',
    name: text(r['שם חברה']) ?? '',
    nameEn: text(r['שם באנגלית']),
    status,
    active: status === 'פעילה',
    address: [street || null, text(r['שם עיר']), text(r['מיקוד'])].filter(Boolean).join(', ') || null,
  };
}

function nonprofitEntry(r: Row): RegistryEntry {
  const status = text(r['סטטוס עמותה']) ?? '';
  return {
    kind: 'nonprofit',
    name: text(r['שם עמותה בעברית']) ?? '',
    nameEn: text(r['שם עמותה באנגלית']),
    status,
    active: status === 'רשומה',
    address: [[text(r['כתובת - רחוב']), text(r['כתובת - מספר דירה'])].filter(Boolean).join(' ') || null, text(r['כתובת - ישוב']), text(r['כתובת - מיקוד'])].filter(Boolean).join(', ') || null,
  };
}

export class RegistryLookup {
  private readonly cache = new Map<string, { at: number; result: RegistryLookupResult }>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: RegistryConfig) {
    this.fetchFn = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
  }

  /** `taxId` is already normalised (tax-id.ts). Failures are never cached; answers are, for `ttlMs`. */
  async lookup(taxId: string): Promise<RegistryLookupResult> {
    const kind = registryOf(taxId);
    if (!kind) return { kind: 'not_found' };
    const cached = this.cache.get(taxId);
    if (cached && this.now() - cached.at < this.config.ttlMs) return cached.result;
    const resource = kind === 'company' ? this.config.companiesResource : this.config.nonprofitsResource;
    const field = kind === 'company' ? COMPANY_NUMBER : NONPROFIT_NUMBER;
    const url = `${this.config.baseUrl}?resource_id=${encodeURIComponent(resource)}&limit=1&filters=${encodeURIComponent(JSON.stringify({ [field]: Number(taxId) }))}`;
    let rows: Row[];
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.config.timeoutMs), headers: { accept: 'application/json' } });
      if (!res.ok) return { kind: 'unavailable' };
      const body = (await res.json()) as { success?: boolean; result?: { records?: Row[] } };
      if (!body.success || !Array.isArray(body.result?.records)) return { kind: 'unavailable' };
      rows = body.result.records;
    } catch {
      return { kind: 'unavailable' };
    }
    const result: RegistryLookupResult = rows[0] ? { kind: 'found', entry: kind === 'company' ? companyEntry(rows[0]) : nonprofitEntry(rows[0]) } : { kind: 'not_found' };
    // Least recently answered goes first: a refreshed key moves to the end, and only a new key evicts.
    if (!this.cache.delete(taxId) && this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(taxId, { at: this.now(), result });
    return result;
  }
}
