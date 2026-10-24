/** Leaves this origin for `url` without a history entry (the carry-over's hand-off to the new address). */
export function leaveTo(url: string): void {
  window.location.replace(url);
}
