/**
 * MUT-755: the shell offers the pilot Welcome at most once per page load (the trial step's rule, MUT-418 D6). After
 * it closes, the cached billing and the server say so; this guards a refetch racing that. Reset on sign-out.
 */
let offered = false;

/** True the first time it is asked on this page (and after a reset), false after. */
export function takePilotWelcomeOffer(): boolean {
  if (offered) return false;
  offered = true;
  return true;
}

export function resetPilotWelcomeOffer(): void {
  offered = false;
}
