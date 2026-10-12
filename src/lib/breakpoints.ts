/**
 * Window widths, in CSS pixels, at which a page changes its arrangement.
 *
 * CSS media queries can't read custom properties, so a width that both code
 * and styles depend on lives here: code reads it through `matchMedia` and
 * sets a data attribute, and the stylesheet keys off that attribute. The
 * number is then written once.
 */
export const BREAKPOINTS = {
  /**
   * From this window width up, a client opens beside the Clients list
   * instead of replacing it (MUT-84, ADR-050). The expanded sidebar (240px),
   * the list column (360px) and a profile whose Work and Payments tables fit
   * without scrolling sideways (about 600px plus padding) must fit. Measured
   * in the browser: at 1200 the profile's tables scrolled; at 1280 they fit.
   */
  clientsSplit: 1280,
} as const;

/** `matchMedia` query for a window at least `width` pixels wide. */
export const minWidthQuery = (width: number) => `(min-width: ${width}px)`;
