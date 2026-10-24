/**
 * MUT-418 (D6): the shell offers the first-run trial step at most once per page load. After an answer the cached
 * /v1/me says so, but a refetch racing the answer must not reopen it. Reset on sign-out (endSession), so the next
 * person in this tab is offered theirs.
 */
let offered = false;

/** True the first time it is asked on this page (and after a reset), false after. */
export function takeTrialWelcomeOffer(): boolean {
  if (offered) return false;
  offered = true;
  return true;
}

export function resetTrialWelcomeOffer(): void {
  offered = false;
}
