/**
 * The later of two dates is never used: the seed must not write a payment or
 * an expense after "now" (ADR-038 rejects future-dated payments; a sample
 * dated next week also reads as a bug).
 */
export function notAfter(date: Date, limit: Date): Date {
  return date.getTime() > limit.getTime() ? new Date(limit.getTime()) : date;
}
