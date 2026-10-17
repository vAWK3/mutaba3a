import contractJson from '../../../docs/analytics/events.json';

/**
 * A typed view of `docs/analytics/events.json`, the only list of what the
 * landing page, the portal and the phone app may send to PostHog (ADR-090).
 * `scripts/__tests__/analytics-taxonomy.test.ts` enforces the file's own rules;
 * this module only reads it.
 */

export type AnalyticsSurface = 'landing' | 'portal' | 'ios' | 'android';

export type PropertyType = 'enum' | 'boolean' | 'integer' | 'currency' | 'semver';

export interface PropertySpec {
  type: PropertyType;
  values?: string[];
  description?: string;
}

export interface EventSpec {
  emitters: AnalyticsSurface[];
  description: string;
  properties?: Record<string, PropertySpec>;
}

export interface AnalyticsContract {
  version: string;
  currencies: string[];
  sharedProperties: Record<'surface' | 'app_version' | 'locale', PropertySpec>;
  events: Record<string, EventSpec>;
}

export const ANALYTICS_CONTRACT = contractJson as AnalyticsContract;

/** The interface languages the contract's `locale` accepts. */
export type AnalyticsLocale = 'ar' | 'en';

/** The spec of `event` if `surface` may send it, otherwise null. */
export function eventSpecFor(event: string, surface: AnalyticsSurface): EventSpec | null {
  const spec = Object.hasOwn(ANALYTICS_CONTRACT.events, event) ? ANALYTICS_CONTRACT.events[event] : undefined;
  return spec && spec.emitters.includes(surface) ? spec : null;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Whether `value` is a valid value of a property of type `spec.type` under this contract. */
export function isValidPropertyValue(spec: PropertySpec, value: unknown): boolean {
  switch (spec.type) {
    case 'enum':
      return typeof value === 'string' && (spec.values ?? []).includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'currency':
      return typeof value === 'string' && ANALYTICS_CONTRACT.currencies.includes(value);
    case 'semver':
      return typeof value === 'string' && SEMVER.test(value);
  }
}
