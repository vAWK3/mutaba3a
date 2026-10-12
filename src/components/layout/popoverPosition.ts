interface HorizontalSpan {
  left: number;
  right: number;
}

/**
 * How far to shift a popover sideways so it stays inside its bounds, `margin`
 * px from either edge (MUT-79). The top bar's popovers live in `<main>`,
 * which clips what overflows it, so on a narrow window a popover opening
 * toward the sidebar would be cut off. A panel wider than the bounds is
 * pinned to the left edge.
 */
export function nudgeInside(panel: HorizontalSpan, bounds: HorizontalSpan, margin: number): number {
  const minLeft = bounds.left + margin;
  const maxRight = bounds.right - margin;
  if (panel.left < minLeft || panel.right - panel.left > maxRight - minLeft) return minLeft - panel.left;
  if (panel.right > maxRight) return maxRight - panel.right;
  return 0;
}
