import { ApiError, type BillingOverview, type IssuedDocType } from '../api/client';
import { isSellable } from './billingView';

/**
 * MUT-731 (ADR-284): the free Starter plan's limits as the portal reads them. Pure. The server decides (GET /v1/billing
 * `usage`, and 409 PLAN_LIMIT at each door); this only says what to show, so a refusal the portal already knows about
 * is shown before the person types (the Issue drawer at 3 of 3) and the same words show when the server refuses.
 */

export type MeterKey = 'documents' | 'scans';
export type UsageLevel = 'ok' | 'near' | 'nudge' | 'at_cap';

export interface StarterMeter {
  meter: MeterKey;
  used: number;
  limit: number;
  level: UsageLevel;
  /** What is left this month (never below 0). */
  left: number;
  /** MUT-733: the over-cap gift lifts this meter's cap until this instant (absent or null otherwise). */
  graceUntil?: string | null;
}

export interface StarterUsage {
  /** YYYY-MM-DD: the 1st of the next Asia/Jerusalem month. */
  resetsOn: string;
  documents: StarterMeter;
  scans: StarterMeter;
}

/** MUT-705: the plans with monthly limits, in rank order (ADR-275). Legacy Freelancer and Malafat have none. */
export const LIMITED_PLANS = ['starter', 'solo', 'business', 'firm'] as const;
export type LimitedPlan = (typeof LIMITED_PLANS)[number];
export type SellablePlan = Exclude<LimitedPlan, 'starter'>;

/** One plan's month: Starter's or a paid plan's meters (MUT-705 / MUT-733), and whether the once-ever gift is left. */
export interface PlanUsage extends StarterUsage {
  plan: LimitedPlan;
  giftAvailable: boolean;
}

/** The next plan up the ladder (Starter → Solo → Business → Firm), or null at the top or off the ladder. */
export function nextPlanOf(plan: string | null | undefined): SellablePlan | null {
  const i = LIMITED_PLANS.indexOf(plan as LimitedPlan);
  return i < 0 || i === LIMITED_PLANS.length - 1 ? null : (LIMITED_PLANS[i + 1] as SellablePlan);
}

/** Butter from 90% (nudge and at the cap), never while the gift runs (wireframe mut-733 A). */
export function meterWarns(meter: Pick<StarterMeter, 'level' | 'graceUntil'>): boolean {
  return !meter.graceUntil && (meter.level === 'nudge' || meter.level === 'at_cap');
}

/** A plan the ladder knows (the URL's `billingPlan`, a 409's `nextPlan`), or null. */
export function sellablePlanOf(value: unknown): SellablePlan | null {
  return value === 'solo' || value === 'business' || value === 'firm' ? value : null;
}

/**
 * MUT-705: the plan the Subscribe step opens on: the smallest on offer whose business count covers the businesses
 * the person owns; the largest when none does; null with nothing on offer.
 */
export function recommendedPlanOf<P extends { plan: string; limits: { businesses: number } }>(plans: readonly P[], ownedBusinesses: number): P | null {
  const ranked = [...plans].sort((a, b) => LIMITED_PLANS.indexOf(a.plan as LimitedPlan) - LIMITED_PLANS.indexOf(b.plan as LimitedPlan));
  return ranked.find((p) => p.limits.businesses >= ownedBusinesses) ?? ranked[ranked.length - 1] ?? null;
}

export type PlanLimitKind = 'documents' | 'scans' | 'businesses' | 'partners' | 'taxAuthority';

/** A 409 PLAN_LIMIT's details (server billing/plan-limit.ts), or the same built from the usage the portal holds. */
export interface PlanLimit {
  limit: PlanLimitKind;
  used?: number;
  cap?: number;
  resetsOn?: string;
  nextPlan: string | null;
  canUpgrade: boolean;
  /** MUT-733: the first refusal on a paid plan carries the once-ever gift (`details.gift: 'available'`). */
  gift?: boolean;
}

const LEVELS: readonly UsageLevel[] = ['ok', 'near', 'nudge', 'at_cap'];

/** GET /v1/billing `starter` (a nullable union the generator types loosely); null where Starter is off. */
export interface BillingStarter {
  chosenAt: string | null;
  canContinueFree: boolean;
}

/** GET /v1/billing `activeBusinesses`: on Starter with more businesses than it keeps active; null otherwise. */
export interface ActiveBusinesses {
  cap: number;
  active: string[];
  readOnly: string[];
  mustChoose: boolean;
}

export function billingStarterOf(billing: Pick<BillingOverview, 'starter'> | null | undefined): BillingStarter | null {
  return (billing?.starter as BillingStarter | null | undefined) ?? null;
}

export function activeBusinessesOf(billing: Pick<BillingOverview, 'activeBusinesses'> | null | undefined): ActiveBusinesses | null {
  return (billing?.activeBusinesses as ActiveBusinesses | null | undefined) ?? null;
}

/**
 * MUT-705: this month's meters on any plan with limits (Starter, Solo, Business, Firm), or null where the plan has none
 * (legacy Freelancer, Malafat, no plan) or the server is older than MUT-731.
 */
export function planUsageOf(billing: Pick<BillingOverview, 'usage'> | null | undefined): PlanUsage | null {
  const usage = billing?.usage;
  if (!usage || !LIMITED_PLANS.includes(usage.plan as LimitedPlan)) return null;
  const meter = (key: MeterKey): StarterMeter | null => {
    const m = usage.meters.find((x) => x.meter === key);
    if (!m || m.limit === null) return null;
    return { meter: key, used: m.used, limit: m.limit, level: m.level, left: Math.max(0, m.limit - m.used), graceUntil: m.graceUntil ?? null };
  };
  const documents = meter('documents');
  const scans = meter('scans');
  if (!documents || !scans) return null;
  return { plan: usage.plan as LimitedPlan, resetsOn: usage.resetsOn, documents, scans, giftAvailable: usage.gift?.available === true };
}

/** This month's Starter meters, or null when the person isn't on Starter (or the server is older than MUT-731). */
export function starterUsageOf(billing: Pick<BillingOverview, 'usage'> | null | undefined): StarterUsage | null {
  const usage = planUsageOf(billing);
  if (!usage || usage.plan !== 'starter') return null;
  const strip = (m: StarterMeter): StarterMeter => ({ meter: m.meter, used: m.used, limit: m.limit, level: m.level, left: m.left });
  return { resetsOn: usage.resetsOn, documents: strip(usage.documents), scans: strip(usage.scans) };
}

/** The details of a 409 PLAN_LIMIT, or null for any other answer. */
export function planLimitOf(error: unknown): PlanLimit | null {
  if (!(error instanceof ApiError) || error.code !== 'PLAN_LIMIT') return null;
  const details = (error.details ?? {}) as Partial<Omit<PlanLimit, 'gift'>> & { gift?: unknown };
  if (!details.limit) return null;
  return {
    limit: details.limit,
    used: details.used,
    cap: details.cap,
    resetsOn: details.resetsOn,
    nextPlan: details.nextPlan === undefined ? 'solo' : details.nextPlan,
    canUpgrade: details.canUpgrade === true,
    ...(details.gift === 'available' ? { gift: true } : {}),
  };
}

/**
 * Basel (2026-11-25): every document counts, but a receipt for a payment on a document already issued is never
 * refused. So the Issue drawer opens refused at the cap for anything but that receipt.
 */
export function documentRefusedNow(usage: StarterUsage | null, docType: IssuedDocType, appliesToDocumentId: string | null | undefined): boolean {
  if (!usage || usage.documents.level !== 'at_cap') return false;
  return !(docType === 'RECEIPT' && appliesToDocumentId);
}

/** The refusal the server would answer, built from the usage the portal holds (shown before the person types). */
export function limitFromUsage(usage: StarterUsage, meter: MeterKey, billing: Pick<BillingOverview, 'configured' | 'catalog'>): PlanLimit {
  const m = usage[meter];
  return { limit: meter, used: m.used, cap: m.limit, resetsOn: usage.resetsOn, nextPlan: 'solo', canUpgrade: isSellable(billing) };
}

/** Whether a Starter refusal may offer Upgrade to Solo: the server says so, and a plan can be bought here. */
export function upgradeOffered(limit: PlanLimit): boolean {
  return limit.canUpgrade && limit.nextPlan !== null;
}

/**
 * Wireframe 7: Home speaks for the fuller meter only (the other speaks where it's used: the Issue drawer for
 * documents). Nothing at `ok`; a hidden nudge stays hidden until the meter reaches its limit.
 */
export function homeNoticeOf(usage: StarterUsage | null, nudgeHidden: (key: string) => boolean): StarterMeter | null {
  if (!usage) return null;
  const rank = (m: StarterMeter) => LEVELS.indexOf(m.level);
  const fuller = rank(usage.scans) >= rank(usage.documents) ? usage.scans : usage.documents;
  if (fuller.level === 'ok') return null;
  if (fuller.level === 'nudge' && nudgeHidden(nudgeHideKey(usage.resetsOn, fuller.meter))) return null;
  return fuller;
}

/** One nudge per meter per month: hiding it keeps it away until the limit (or the next month). */
export function nudgeHideKey(resetsOn: string, meter: MeterKey): string {
  return `mut731-nudge:${resetsOn}:${meter}`;
}

const HIDE_STORE = 'mutaba3a-plan-nudges';

/** Per-viewer convenience (DESIGN: never state that must persist): which nudges this browser hid. */
export function nudgeHidden(key: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(HIDE_STORE) ?? '[]') as string[]).includes(key);
  } catch {
    return false;
  }
}

export function hideNudge(key: string): void {
  try {
    const keys = JSON.parse(localStorage.getItem(HIDE_STORE) ?? '[]') as string[];
    localStorage.setItem(HIDE_STORE, JSON.stringify([...keys.filter((k) => k !== key), key].slice(-12)));
  } catch {
    // A blocked store only means the nudge comes back on the next visit.
  }
}
