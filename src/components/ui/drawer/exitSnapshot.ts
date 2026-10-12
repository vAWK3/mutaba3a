/**
 * The last frame of a drawer that has already closed (MUT-80, D3).
 *
 * Callers close a drawer by resetting its store, which unmounts it at once.
 * Keeping the live tree mounted for its exit would re-render it with the reset
 * state (an edit title turning into "New", a deleted record into a loading
 * state), so the frame clones its overlay and panel instead, with whatever the
 * person had typed, picked and scrolled, and animates the clone out. The clone
 * is inert and hidden from assistive technology: the dialog is gone.
 */
export interface ExitSnapshot {
  overlay: HTMLElement;
  panel: HTMLElement;
  /** Insert the clones where the originals were, then restore scroll positions. */
  attach: () => void;
  remove: () => void;
}

type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const FORM_FIELDS = 'input, textarea, select';

function copyFieldState(source: FormField, clone: FormField) {
  if (source instanceof HTMLSelectElement) {
    (clone as HTMLSelectElement).selectedIndex = source.selectedIndex;
  } else if (source instanceof HTMLInputElement && (source.type === 'checkbox' || source.type === 'radio')) {
    (clone as HTMLInputElement).checked = source.checked;
  } else if (!(source instanceof HTMLInputElement && source.type === 'file')) {
    clone.value = source.value;
  }
}

function hideFromEveryone(clone: HTMLElement) {
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  clone.style.pointerEvents = 'none';
  // No duplicate ids while the clone plays out (MUT-82). A drawer opened in
  // that time would otherwise find the clone's elements first: the payment
  // drawer's footer button, linked to its form by id, submitted the clone's
  // form natively and reloaded the page.
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
}

interface ScrollPosition {
  index: number;
  top: number;
  left: number;
}

function scrollPositions(root: HTMLElement): ScrollPosition[] {
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  return elements.flatMap((element, index) =>
    element.scrollTop || element.scrollLeft ? [{ index, top: element.scrollTop, left: element.scrollLeft }] : [],
  );
}

function restoreScroll(root: HTMLElement, positions: ScrollPosition[]) {
  if (positions.length === 0) return;
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const { index, top, left } of positions) {
    elements[index].scrollTop = top;
    elements[index].scrollLeft = left;
  }
}

function cloneWithState(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceFields = source.querySelectorAll<FormField>(FORM_FIELDS);
  const cloneFields = clone.querySelectorAll<FormField>(FORM_FIELDS);
  sourceFields.forEach((field, index) => copyFieldState(field, cloneFields[index]));
  hideFromEveryone(clone);
  return clone;
}

/** Clone the overlay and panel now, while they still hold the person's input; attach later. */
export function captureExitSnapshot(overlay: HTMLElement, panel: HTMLElement): ExitSnapshot {
  const parent = panel.parentNode;
  const nextSibling = panel.nextSibling;
  const panelScroll = scrollPositions(panel);
  const overlayClone = cloneWithState(overlay);
  const panelClone = cloneWithState(panel);

  return {
    overlay: overlayClone,
    panel: panelClone,
    attach() {
      if (!parent) return;
      const anchor = nextSibling && nextSibling.parentNode === parent ? nextSibling : null;
      parent.insertBefore(overlayClone, anchor);
      parent.insertBefore(panelClone, anchor);
      restoreScroll(panelClone, panelScroll);
    },
    remove() {
      overlayClone.remove();
      panelClone.remove();
    },
  };
}
