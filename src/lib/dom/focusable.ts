/**
 * The elements Tab can reach inside a container, shared by the menu button's
 * dialog mode (MUT-79) and the drawer's focus trap (MUT-80).
 */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isRendered(element: HTMLElement): boolean {
  if (element.closest('[hidden]')) return false;
  // `checkVisibility` also skips display:none sections; engines without it
  // (older WebKit, jsdom) count everything not [hidden] as reachable.
  return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

/** Focusable descendants of `root`, in document (Tab) order. */
export function focusablesWithin(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isRendered);
}
