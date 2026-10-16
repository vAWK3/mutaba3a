/**
 * Per-test timeout for the few tests that pass in ~1–3 s on a plain run but
 * cross Vitest's 5 s default under v8 coverage instrumentation (MUT-24 §C):
 * the first full render of a heavy page in its file, or a test that re-sorts
 * or re-renders a full table several times. Pass it as the test's options:
 * `it('…', SLOW_UNDER_COVERAGE, () => { … })`. The global timeout stays at
 * 5 s on purpose, so a genuinely hung test still fails fast everywhere else.
 */
export const SLOW_UNDER_COVERAGE = { timeout: 15_000 } as const;
