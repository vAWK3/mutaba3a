import { CreateCustomerRequestSchema } from '../../../../server/src/schemas.js';
import type {
  FreeAppBackup,
  FreeAppClient,
  FreeAppExpense,
  FreeAppPaymentRecord,
  FreeAppProfile,
  FreeAppProject,
  FreeAppTransaction,
} from './freeAppBackup';

/**
 * The free app's backup, as the requests that recreate it in local mode
 * (MUT-291 §3.3). Pure: no ids are minted here. Every op names its own `ref`
 * and the refs it needs, and `replay.ts` sends the ops in order, mapping refs
 * to the ids the routes return. The server's own rules then check every
 * record; this file only reshapes what the API has no place for, and reports
 * each such change (`changed`) or omission (`notCarried`) with a count.
 *
 * Owner decisions (2026-10-24): D2 each old business becomes a Business
 * profile, at most five; the built-in Personal stays empty. D4 an Owed with no
 * client goes under the profile's "No client" client; an entry in another
 * currency than its project keeps its client and drops the project.
 */

/** The cap of six owned profiles (server/src/routes/profiles.ts MAX_OWNED_PROFILES) less the built-in Personal one. */
export const MAX_CARRIED_BUSINESSES = 5;
const CARRIED_CURRENCIES = ['ILS', 'USD', 'EUR', 'JOD'] as const;
type CarriedCurrency = (typeof CARRIED_CURRENCIES)[number];

const NAME_MAX = 200;
const PROFILE_NAME_MAX = 80;
const PHONE_MAX = 64;
const NOTES_MAX = 4000;
const INCOME_NOTES_MAX = 2000;
const CATEGORY_NAME_MAX = 60;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type ChangeCode =
  | 'business-archived-carried'
  | 'business-created'
  | 'business-details-dropped'
  | 'business-name-shortened'
  | 'unscoped-assigned'
  | 'client-email-dropped'
  | 'client-details-shortened'
  | 'client-kept-active'
  | 'project-no-client'
  | 'project-details-dropped'
  | 'owed-no-client'
  | 'project-currency-dropped'
  | 'due-date-moved'
  | 'paid-before-entry-moved'
  | 'owed-notes-dropped'
  | 'payment-notes-dropped'
  | 'income-category-dropped'
  | 'review-flag-dropped'
  | 'expense-project-dropped'
  | 'text-shortened';

export type NotCarriedCode =
  | 'business-over-cap'
  | 'record-of-business-over-cap'
  | 'archived-entry'
  | 'currency'
  | 'amount'
  | 'conversion-incomplete'
  | 'conversion-same-currency'
  | 'receipt-unattached'
  | 'vendors'
  | 'recurring-rules'
  | 'recurring-occurrences'
  | 'documents'
  | 'engagements'
  | 'month-close'
  | 'malformed'
  /** Added by the replay: a route refused the record (the line carries the API's reason). */
  | 'refused'
  /** Added by the replay: the record it belongs to was not carried. */
  | 'parent-not-carried';

export interface ReportLine<C extends string> {
  code: C;
  count: number;
  /** The API's `details.reason` (or code) for a `refused` line. */
  reason?: string;
}

export interface CarryOverReport {
  changed: Array<ReportLine<ChangeCode>>;
  notCarried: Array<ReportLine<NotCarriedCode>>;
  /** JOD income and expenses carried: a CSV import may have stored them 10× too small (TD-112), which nothing can tell. */
  jodEntries: number;
}

/** Where an op came from in the backup: a table and a row id (or `uncovered:<transactionId>` for a paid amount no payment record covers). */
export interface OpSource {
  table: 'businessProfiles' | 'clients' | 'projects' | 'transactions' | 'paymentRecords' | 'uncovered' | 'expenses' | 'expenseCategories' | 'receipts' | 'placeholder';
  id: string;
}

interface OpBase {
  ref: string;
  source: OpSource;
  /** The profile the request is sent for (X-Mutaba3a-Profile), by ref; absent for creating a profile. */
  profile?: string;
}

export type CarryOp =
  | (OpBase & { op: 'profile'; name: string; defaultCurrency: CarriedCurrency })
  | (OpBase & { op: 'category'; profile: string; name: string; color?: string })
  | (OpBase & { op: 'customer'; profile: string; name: string; email?: string; phone?: string; notes?: string })
  | (OpBase & { op: 'project'; profile: string; customer: string; name: string; currency: CarriedCurrency })
  | (OpBase & { op: 'owed'; profile: string; customer: string; project?: string; amountMinor: number; currency: CarriedCurrency; occurredOn: string; dueDate?: string; title?: string })
  | (OpBase & { op: 'received'; profile: string; customer?: string; project?: string; amountMinor: number; currency: CarriedCurrency; occurredOn: string; notes?: string })
  | (OpBase & { op: 'settle'; profile: string; owed: string; amountMinor: number; currency: CarriedCurrency; paidAt: string })
  | (OpBase & { op: 'expense'; profile: string; amountMinor: number; currency: CarriedCurrency; occurredOn: string; title?: string; vendor?: string; category?: string; customer?: string; project?: string; notes?: string })
  | (OpBase & { op: 'receipt'; profile: string; expense: string; fileName: string; mimeType: string; sizeBytes: number; data: string })
  | (OpBase & { op: 'conversion'; profile: string; amountMinor: number; currency: CarriedCurrency; toAmountMinor: number; toCurrency: CarriedCurrency; occurredOn: string; notes?: string })
  | (OpBase & { op: 'archive-project'; profile: string; project: string })
  | (OpBase & { op: 'archive-customer'; profile: string; customer: string });

export interface CarryOverPlan {
  ops: CarryOp[];
  report: CarryOverReport;
}

export interface MapOptions {
  /** The browser's IANA timezone: new profiles take it, and ISO datetimes become dates in it. */
  timezone: string;
  /** The two names this file has to make up, in the person's language. */
  labels: { noClient: string; defaultBusiness: string };
}

/** The refs an op needs to exist first; replay.ts skips an op whose dependency wasn't carried. */
export function dependenciesOf(op: CarryOp): string[] {
  const refs: Array<string | undefined> = [op.profile];
  switch (op.op) {
    case 'project':
      refs.push(op.customer);
      break;
    case 'owed':
    case 'received':
      refs.push(op.customer, op.project);
      break;
    case 'settle':
      refs.push(op.owed);
      break;
    case 'expense':
      refs.push(op.category, op.customer, op.project);
      break;
    case 'receipt':
      refs.push(op.expense);
      break;
    case 'archive-project':
      refs.push(op.project);
      break;
    case 'archive-customer':
      refs.push(op.customer);
      break;
  }
  return refs.filter((ref): ref is string => typeof ref === 'string');
}

export function mapFreeAppBackup(backup: FreeAppBackup, options: MapOptions): CarryOverPlan {
  return new Mapper(backup, options).run();
}

class Mapper {
  private readonly ops: CarryOp[] = [];
  private readonly changed = new Map<ChangeCode, number>();
  private readonly notCarried = new Map<NotCarriedCode, number>();
  private jodEntries = 0;

  /** Old business id → profile ref, for the businesses carried. */
  private readonly profileRefs = new Map<string, string>();
  /** Old business ids over the cap: their records are listed, not carried. */
  private readonly overCap = new Set<string>();
  private readonly profileCurrency = new Map<string, CarriedCurrency>();
  private defaultProfile: string | null = null;

  private readonly clients = new Map<string, { ref: string; profile: string }>();
  private readonly projects = new Map<string, { ref: string; profile: string; customer: string; currency: CarriedCurrency; clientId: string | null; archived: boolean }>();
  private readonly noClient = new Map<string, string>();
  private readonly categories = new Map<string, string>();

  constructor(
    private readonly backup: FreeAppBackup,
    private readonly options: MapOptions,
  ) {}

  run(): CarryOverPlan {
    this.mapProfiles();
    this.mapClients();
    this.mapProjects();
    this.mapIncome();
    this.mapExpenses();
    this.mapConversions();
    this.mapArchives();
    this.countTheRest();
    return { ops: this.ops, report: this.report() };
  }

  // ── profiles ───────────────────────────────────────────────────────────────

  private mapProfiles(): void {
    const businesses = [...this.backup.tables.businessProfiles].sort(byCarryOrder);
    businesses.forEach((business, index) => {
      if (index >= MAX_CARRIED_BUSINESSES) {
        this.overCap.add(business.id);
        this.note('business-over-cap', 'notCarried');
        return;
      }
      const ref = `profile:${business.id}`;
      const currency = asCurrency(business.defaultCurrency) ?? 'ILS';
      const name = this.shorten(business.name.trim() || this.options.labels.defaultBusiness, PROFILE_NAME_MAX, 'business-name-shortened');
      if (business.archivedAt) this.note('business-archived-carried');
      if (business.logoDataUrl || business.primaryColor || business.email || business.phone || business.nameEn) this.note('business-details-dropped');
      this.ops.push({ op: 'profile', ref, source: { table: 'businessProfiles', id: business.id }, name, defaultCurrency: currency });
      this.profileRefs.set(business.id, ref);
      this.profileCurrency.set(ref, currency);
    });
    this.defaultProfile = businesses.length > 0 && !this.overCap.has(businesses[0]!.id) ? this.profileRefs.get(businesses[0]!.id)! : null;
  }

  /** The profile a row goes to: its own business, the default one for a row with none (legacy rows, CSV conversions), or null when its business is over the cap. */
  private profileFor(profileId: string | undefined): string | null {
    if (profileId && this.overCap.has(profileId)) {
      this.note('record-of-business-over-cap', 'notCarried');
      return null;
    }
    const own = profileId ? this.profileRefs.get(profileId) : undefined;
    if (own) return own;
    this.note('unscoped-assigned');
    return this.ensureDefaultProfile();
  }

  /** A device with records but no business (data from before businesses existed) gets one. */
  private ensureDefaultProfile(): string {
    if (this.defaultProfile) return this.defaultProfile;
    const ref = 'profile:default';
    const currency = this.mostCommonCurrency() ?? 'ILS';
    this.ops.unshift({ op: 'profile', ref, source: { table: 'placeholder', id: 'default-business' }, name: this.shorten(this.options.labels.defaultBusiness, PROFILE_NAME_MAX, 'business-name-shortened'), defaultCurrency: currency });
    this.note('business-created');
    this.defaultProfile = ref;
    this.profileCurrency.set(ref, currency);
    return ref;
  }

  private mostCommonCurrency(): CarriedCurrency | null {
    return majority([...this.backup.tables.transactions.map((t) => t.currency), ...this.backup.tables.expenses.map((e) => e.currency)].map(asCurrency).filter((c): c is CarriedCurrency => c !== null));
  }

  // ── clients and projects ─────────────────────────────────────────────────────

  private mapClients(): void {
    for (const client of this.backup.tables.clients) {
      const profile = this.profileFor(client.profileId);
      if (!profile) continue;
      const ref = `customer:${client.id}`;
      this.ops.push({ op: 'customer', ref, source: { table: 'clients', id: client.id }, profile, ...this.customerFields(client) });
      this.clients.set(client.id, { ref, profile });
    }
  }

  private customerFields(client: FreeAppClient): { name: string; email?: string; phone?: string; notes?: string } {
    const fields: { name: string; email?: string; phone?: string; notes?: string } = { name: this.shorten(client.name.trim() || this.options.labels.noClient, NAME_MAX, 'client-details-shortened') };
    const email = client.email?.trim();
    if (email) {
      if (CreateCustomerRequestSchema.shape.email.safeParse(email).success) fields.email = email;
      else this.note('client-email-dropped');
    }
    const phone = client.phone?.trim();
    if (phone) fields.phone = this.shorten(phone, PHONE_MAX, 'client-details-shortened');
    if (client.notes) fields.notes = this.shorten(client.notes, NOTES_MAX, 'client-details-shortened');
    return fields;
  }

  /** The profile's "No client" client (D4), created the first time something needs it. */
  private noClientOf(profile: string): string {
    const existing = this.noClient.get(profile);
    if (existing) return existing;
    const ref = `customer:no-client:${profile}`;
    this.ops.push({ op: 'customer', ref, source: { table: 'placeholder', id: `no-client:${profile}` }, profile, name: this.options.labels.noClient });
    this.noClient.set(profile, ref);
    return ref;
  }

  private mapProjects(): void {
    for (const project of this.backup.tables.projects) {
      const profile = this.profileFor(project.profileId);
      if (!profile) continue;
      const client = project.clientId ? this.clients.get(project.clientId) : undefined;
      let customer = client && client.profile === profile ? client.ref : null;
      if (!customer) {
        this.note('project-no-client');
        customer = this.noClientOf(profile);
      }
      if (project.field || project.notes) this.note('project-details-dropped');
      const currency = this.projectCurrency(project, profile);
      const ref = `project:${project.id}`;
      this.ops.push({ op: 'project', ref, source: { table: 'projects', id: project.id }, profile, customer, name: this.shorten(project.name.trim() || this.options.labels.noClient, NAME_MAX, 'text-shortened'), currency });
      this.projects.set(project.id, { ref, profile, customer, currency, clientId: client && client.profile === profile ? project.clientId! : null, archived: Boolean(project.archivedAt) });
    }
  }

  /** D4: a project holds one currency; the one most of its entries use, else its profile's. */
  private projectCurrency(project: FreeAppProject, profile: string): CarriedCurrency {
    const used = [
      ...this.backup.tables.transactions.filter((t) => t.projectId === project.id && t.kind === 'income' && !t.deletedAt && !t.archivedAt).map((t) => t.currency),
      ...this.backup.tables.expenses.filter((e) => e.projectId === project.id && !e.deletedAt).map((e) => e.currency),
    ];
    return majority(used.map(asCurrency).filter((c): c is CarriedCurrency => c !== null)) ?? this.profileCurrency.get(profile) ?? 'ILS';
  }

  // ── income ─────────────────────────────────────────────────────────────────

  private mapIncome(): void {
    const records = groupBy(this.backup.tables.paymentRecords.filter((r) => !r.deletedAt), (r) => r.transactionId);
    for (const tx of this.backup.tables.transactions) {
      if (tx.kind !== 'income' || tx.deletedAt) continue;
      if (tx.archivedAt) {
        this.note('archived-entry', 'notCarried');
        continue;
      }
      const currency = this.carriedCurrency(tx.currency);
      if (!currency) continue;
      if (tx.amountMinor <= 0) {
        this.note('amount', 'notCarried');
        continue;
      }
      const profile = this.profileFor(tx.profileId);
      if (!profile) continue;
      this.mapIncomeEntry(tx, profile, currency, (records.get(tx.id) ?? []).sort((a, b) => a.paidAt.localeCompare(b.paidAt)));
    }
  }

  private mapIncomeEntry(tx: FreeAppTransaction, profile: string, currency: CarriedCurrency, records: FreeAppPaymentRecord[]): void {
    const occurredOn = this.dateOf(tx.occurredAt);
    const { customer, project } = this.incomeLinks(tx, profile, currency);
    if (tx.categoryId) this.note('income-category-dropped');
    if (tx.needsReview) this.note('review-flag-dropped');
    if (currency === 'JOD') this.jodEntries++;

    const recorded = records.reduce((sum, r) => sum + r.amountMinor, 0);
    const target = tx.status === 'paid' ? tx.amountMinor : (tx.receivedAmountMinor ?? 0);
    const uncovered = Math.max(0, target - recorded);
    const payments: Array<{ source: OpSource; amountMinor: number; paidAt: string; notes?: string | undefined }> = records.map((r) => ({ source: { table: 'paymentRecords', id: r.id }, amountMinor: r.amountMinor, paidAt: r.paidAt, notes: r.notes }));
    if (uncovered > 0) payments.push({ source: { table: 'uncovered', id: tx.id }, amountMinor: uncovered, paidAt: tx.paidAt ?? tx.occurredAt });
    if (payments.some((p) => p.notes)) this.note('payment-notes-dropped');

    // Paid with no client: Received money, one entry per payment. Otherwise an Owed and one settle per payment.
    if (tx.status === 'paid' && !customer) {
      payments.forEach((payment, i) =>
        this.ops.push({ op: 'received', ref: `received:${payment.source.table}:${payment.source.id}`, source: payment.source, profile, ...(project ? { project } : {}), amountMinor: payment.amountMinor, currency, occurredOn: this.paidOn(payment.paidAt, occurredOn), ...(i === 0 && tx.notes ? { notes: this.shorten(tx.notes, INCOME_NOTES_MAX, 'text-shortened') } : {}) }),
      );
      return;
    }

    const owedCustomer = customer ?? this.noClientWith('owed-no-client', profile);
    const owedRef = `owed:${tx.id}`;
    const title = tx.title?.trim();
    let dueDate = tx.dueDate ? this.dateOf(tx.dueDate) : undefined;
    if (dueDate && dueDate < occurredOn) {
      this.note('due-date-moved');
      dueDate = occurredOn;
    }
    if (tx.notes) this.note('owed-notes-dropped');
    this.ops.push({ op: 'owed', ref: owedRef, source: { table: 'transactions', id: tx.id }, profile, customer: owedCustomer, ...(project ? { project } : {}), amountMinor: tx.amountMinor, currency, occurredOn, ...(dueDate ? { dueDate } : {}), ...(title ? { title: this.shorten(title, NAME_MAX, 'text-shortened') } : {}) });
    for (const payment of payments) {
      this.ops.push({ op: 'settle', ref: `settle:${payment.source.table}:${payment.source.id}`, source: payment.source, profile, owed: owedRef, amountMinor: payment.amountMinor, currency, paidAt: this.paidOn(payment.paidAt, occurredOn) });
    }
  }

  /** The entry's client and project, by D4: a project in another currency is dropped, the client kept. */
  private incomeLinks(tx: FreeAppTransaction, profile: string, currency: CarriedCurrency): { customer: string | null; project: string | null } {
    const client = tx.clientId ? this.clients.get(tx.clientId) : undefined;
    let customer = client && client.profile === profile ? client.ref : null;
    const found = tx.projectId ? this.projects.get(tx.projectId) : undefined;
    let project = found && found.profile === profile ? found : undefined;
    if (project && customer && project.customer !== customer) project = undefined;
    if (project && project.currency !== currency) {
      this.note('project-currency-dropped');
      customer ??= project.clientId ? project.customer : null;
      project = undefined;
    }
    if (project && !customer) customer = project.customer;
    return { customer, project: project?.ref ?? null };
  }

  private noClientWith(code: ChangeCode, profile: string): string {
    this.note(code);
    return this.noClientOf(profile);
  }

  /** A payment dated before its entry is moved to the entry's date (the API refuses it otherwise). */
  private paidOn(paidAt: string, occurredOn: string): string {
    const paid = this.dateOf(paidAt);
    if (paid >= occurredOn) return paid;
    this.note('paid-before-entry-moved');
    return occurredOn;
  }

  // ── expenses ───────────────────────────────────────────────────────────────

  private mapExpenses(): void {
    const legacyCategories = new Map(this.backup.tables.categories.filter((c) => c.kind === 'expense').map((c) => [c.id, c.name]));
    const expenseCategories = new Map(this.backup.tables.expenseCategories.map((c) => [c.id, c]));
    const vendors = new Map(this.backup.tables.vendors.map((v) => [v.id, v.canonicalName]));

    // Every category the person made comes over, used or not.
    for (const category of this.backup.tables.expenseCategories) {
      const profile = this.profileRefs.get(category.profileId);
      if (profile) this.categoryRef(profile, category.name, category.color);
    }

    for (const tx of this.backup.tables.transactions) {
      if (tx.kind !== 'expense' || tx.deletedAt) continue;
      if (tx.archivedAt) {
        this.note('archived-entry', 'notCarried');
        continue;
      }
      const name = tx.categoryId ? legacyCategories.get(tx.categoryId) : undefined;
      this.mapExpense({ id: tx.id, profileId: tx.profileId, title: tx.title, vendor: undefined, clientId: tx.clientId, projectId: tx.projectId, categoryName: name, amountMinor: tx.amountMinor, currency: tx.currency, occurredAt: tx.occurredAt, notes: tx.notes }, 'transactions');
    }
    for (const expense of this.backup.tables.expenses) {
      if (expense.deletedAt) continue;
      const category = expense.categoryId ? expenseCategories.get(expense.categoryId) : undefined;
      const vendor = expense.vendor?.trim() || (expense.vendorId ? vendors.get(expense.vendorId) : undefined);
      this.mapExpense({ id: expense.id, profileId: expense.profileId, title: expense.title, vendor, clientId: expense.clientId, projectId: expense.projectId, categoryName: category?.name, amountMinor: expense.amountMinor, currency: expense.currency, occurredAt: expense.occurredAt, notes: expense.notes }, 'expenses');
    }
  }

  private mapExpense(row: Pick<FreeAppExpense, 'id' | 'title' | 'clientId' | 'projectId' | 'amountMinor' | 'currency' | 'occurredAt' | 'notes'> & { profileId: string | undefined; vendor: string | undefined; categoryName: string | undefined }, table: 'transactions' | 'expenses'): void {
    const currency = this.carriedCurrency(row.currency);
    if (!currency) return;
    if (row.amountMinor <= 0) {
      this.note('amount', 'notCarried');
      return;
    }
    const profile = this.profileFor(row.profileId);
    if (!profile) return;
    if (currency === 'JOD') this.jodEntries++;

    const client = row.clientId ? this.clients.get(row.clientId) : undefined;
    const customer = client && client.profile === profile ? client.ref : undefined;
    const found = row.projectId ? this.projects.get(row.projectId) : undefined;
    let project = found && found.profile === profile ? found : undefined;
    if (project && customer && project.customer !== customer) {
      this.note('expense-project-dropped');
      project = undefined;
    }
    const title = row.title?.trim();
    const vendor = row.vendor?.trim();
    const ref = `expense:${table}:${row.id}`;
    this.ops.push({
      op: 'expense',
      ref,
      source: { table, id: row.id },
      profile,
      amountMinor: row.amountMinor,
      currency,
      occurredOn: this.dateOf(row.occurredAt),
      ...(title ? { title: this.shorten(title, NAME_MAX, 'text-shortened') } : {}),
      ...(vendor ? { vendor: this.shorten(vendor, NAME_MAX, 'text-shortened') } : {}),
      ...(row.categoryName?.trim() ? { category: this.categoryRef(profile, row.categoryName) } : {}),
      ...(customer ? { customer } : {}),
      ...(project ? { project: project.ref } : {}),
      ...(row.notes ? { notes: this.shorten(row.notes, NOTES_MAX, 'text-shortened') } : {}),
    });
    if (table === 'expenses') this.mapReceiptsOf(row.id, ref, profile);
  }

  /** One category op per profile and name (case-insensitive); replay.ts finds a preset of that name before creating one. */
  private categoryRef(profile: string, rawName: string, color?: string): string {
    const name = rawName.trim().slice(0, CATEGORY_NAME_MAX);
    const key = `${profile}|${name.toLocaleLowerCase()}`;
    const existing = this.categories.get(key);
    if (existing) return existing;
    const ref = `category:${profile}:${this.categories.size}`;
    this.ops.push({ op: 'category', ref, source: { table: 'expenseCategories', id: key }, profile, name, ...(color && HEX_COLOR.test(color) ? { color } : {}) });
    this.categories.set(key, ref);
    return ref;
  }

  private mapReceiptsOf(expenseId: string, expenseRef: string, profile: string): void {
    for (const receipt of this.backup.tables.receipts.filter((r) => r.expenseId === expenseId)) {
      this.ops.push({ op: 'receipt', ref: `receipt:${receipt.id}`, source: { table: 'receipts', id: receipt.id }, profile, expense: expenseRef, fileName: receipt.fileName.slice(0, NAME_MAX), mimeType: receipt.mimeType, sizeBytes: receipt.sizeBytes, data: receipt.data });
    }
  }

  // ── conversions ────────────────────────────────────────────────────────────

  private mapConversions(): void {
    for (const tx of this.backup.tables.transactions) {
      if (tx.kind !== 'conversion' || tx.deletedAt) continue;
      if (tx.archivedAt) {
        this.note('archived-entry', 'notCarried');
        continue;
      }
      if (!tx.toCurrency || tx.toAmountMinor === undefined) {
        this.note('conversion-incomplete', 'notCarried');
        continue;
      }
      const currency = this.carriedCurrency(tx.currency);
      const toCurrency = currency ? this.carriedCurrency(tx.toCurrency) : null;
      if (!currency || !toCurrency) continue;
      if (currency === toCurrency) {
        this.note('conversion-same-currency', 'notCarried');
        continue;
      }
      if (tx.amountMinor <= 0 || tx.toAmountMinor <= 0) {
        this.note('amount', 'notCarried');
        continue;
      }
      const profile = this.profileFor(tx.profileId);
      if (!profile) continue;
      this.ops.push({ op: 'conversion', ref: `conversion:${tx.id}`, source: { table: 'transactions', id: tx.id }, profile, amountMinor: tx.amountMinor, currency, toAmountMinor: tx.toAmountMinor, toCurrency, occurredOn: this.dateOf(tx.occurredAt), ...(tx.notes ? { notes: this.shorten(tx.notes, NOTES_MAX, 'text-shortened') } : {}) });
    }
  }

  // ── archives, and what has no home ─────────────────────────────────────────

  /** Archived projects first: a client can be archived only once none of its projects is active. */
  private mapArchives(): void {
    for (const [id, project] of this.projects) {
      if (project.archived) this.ops.push({ op: 'archive-project', ref: `archive-project:${id}`, source: { table: 'projects', id }, profile: project.profile, project: project.ref });
    }
    for (const client of this.backup.tables.clients) {
      const carried = this.clients.get(client.id);
      if (!client.archivedAt || !carried) continue;
      const activeProject = [...this.projects.values()].some((p) => p.customer === carried.ref && !p.archived);
      if (activeProject) {
        this.note('client-kept-active');
        continue;
      }
      this.ops.push({ op: 'archive-customer', ref: `archive-customer:${client.id}`, source: { table: 'clients', id: client.id }, profile: carried.profile, customer: carried.ref });
    }
  }

  private countTheRest(): void {
    const { tables, counted, malformed } = this.backup;
    const carriedExpenses = new Set(tables.expenses.filter((e) => !e.deletedAt).map((e) => e.id));
    this.add('receipt-unattached', tables.receipts.filter((r) => !r.expenseId || !carriedExpenses.has(r.expenseId)).length);
    this.add('vendors', tables.vendors.length);
    this.add('recurring-rules', counted.recurringRules);
    this.add('recurring-occurrences', counted.recurringOccurrences);
    this.add('documents', counted.documents);
    this.add('engagements', counted.engagements);
    this.add('month-close', counted.monthCloseStatuses);
    this.add('malformed', Object.values(malformed).reduce((sum, n) => sum + (n ?? 0), 0));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private carriedCurrency(value: string): CarriedCurrency | null {
    const currency = asCurrency(value);
    if (!currency) this.note('currency', 'notCarried');
    return currency;
  }

  /** A date as the API wants it: `YYYY-MM-DD` as is, an ISO datetime as its day in the browser's timezone. */
  private dateOf(value: string): string {
    return localDate(value, this.options.timezone);
  }

  private shorten(value: string, max: number, code: ChangeCode): string {
    if (value.length <= max) return value;
    this.note(code);
    return value.slice(0, max);
  }

  private note(code: ChangeCode): void;
  private note(code: NotCarriedCode, list: 'notCarried'): void;
  private note(code: string, list: 'changed' | 'notCarried' = 'changed'): void {
    const map = (list === 'changed' ? this.changed : this.notCarried) as Map<string, number>;
    map.set(code, (map.get(code) ?? 0) + 1);
  }

  private add(code: NotCarriedCode, count: number): void {
    if (count > 0) this.notCarried.set(code, (this.notCarried.get(code) ?? 0) + count);
  }

  private report(): CarryOverReport {
    return {
      changed: [...this.changed].map(([code, count]) => ({ code, count })),
      notCarried: [...this.notCarried].map(([code, count]) => ({ code, count })),
      jodEntries: this.jodEntries,
    };
  }
}

/** Default first, then active before archived, then oldest first. */
function byCarryOrder(a: FreeAppProfile, b: FreeAppProfile): number {
  if (Boolean(a.isDefault) !== Boolean(b.isDefault)) return a.isDefault ? -1 : 1;
  if (Boolean(a.archivedAt) !== Boolean(b.archivedAt)) return a.archivedAt ? 1 : -1;
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
}

function asCurrency(value: string): CarriedCurrency | null {
  return (CARRIED_CURRENCIES as readonly string[]).includes(value) ? (value as CarriedCurrency) : null;
}

/** The most frequent value; ties go to the one seen first. */
function majority<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` as is; an ISO datetime as its calendar day in `timezone`, never a slice of the UTC string. */
export function localDate(value: string, timezone: string): string {
  if (DATE_ONLY.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value.slice(0, 10);
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}
