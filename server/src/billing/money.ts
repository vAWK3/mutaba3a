/** MUT-525: money as Stripe's page and the billing mails print it (ADR-004: always with its own currency). */

/** An amount for Stripe's page and for mail: `₪145`, `$45`, `$24.99`. The symbol never depends on the reader's language. */
export function formatMinor(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(minor / 100);
}
