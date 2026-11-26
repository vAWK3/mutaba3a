/**
 * MUT-735/731 (ADR-281, ADR-284): thrown when a hard-capped meter is at its cap. Inside a Postgres transaction it rolls
 * back everything the action wrote; the memory store throws it before writing. Callers turn it into 409 PLAN_LIMIT.
 */
export class UsageCapReached extends Error {
  constructor(
    readonly used: number,
    readonly cap: number,
  ) {
    super(`usage cap reached (${used}/${cap})`);
  }
}
