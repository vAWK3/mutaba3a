import { animate, motionValue, type AnimationPlaybackControls, type MotionValue } from 'motion';
import { REDUCED_MOTION_FADE_SECONDS, UI_SPRING } from './presets';

/**
 * A table row leaving its list (MUT-82, brief H1: "the row slides out").
 *
 * The same idea as a drawer's exit (ADR-044 §2): the state change is
 * immediate and the exit is presentation. The row is already gone from the
 * data; an inert, hidden copy of its last frame is laid over where it was and
 * slides toward the inline end while it fades, and the rows after it glide up
 * into the gap on the same spring. Reduced motion fades the copy and moves
 * nothing (ADR-044 §5). No layout means no motion: nothing is captured.
 *
 * The copy is laid over the list's container rather than put back in the
 * table, so it can play even when the list it left is replaced by an empty
 * state. The container must be the copy's containing block (`position:
 * relative`) and should clip it (`overflow: hidden`).
 *
 * Usage, from a layout-effect cleanup while the row is still in the document:
 *   const exit = captureRowExit(row, section);
 *   queueMicrotask(() => exit?.play({ reducedMotion }));
 */

/** Class of the copy while it plays out. */
export const ROW_EXIT_CLASS = 'row-exit';

export interface RowExit {
  /**
   * Lay the copy over the list and play it out, after the commit that removed
   * the row. Does nothing while the row is still in the document (StrictMode's
   * rehearsal) or once the list has left it (the screen was navigated away).
   */
  play(options: { reducedMotion: boolean }): void;
}

interface Follower {
  row: HTMLElement;
  top: number;
}

interface Glide {
  offset: MotionValue<number>;
  controls: AnimationPlaybackControls;
}

/** Rows gliding into a gap, so a second exit picks them up from where they are. */
const glides = new WeakMap<HTMLElement, Glide>();

function hideFromEveryone(element: HTMLElement) {
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('inert', '');
  element.style.pointerEvents = 'none';
}

/**
 * The row and the elements between it and the container, each copied without
 * their other children, so the cells keep the styles their ancestors give
 * them (`.data-table td`). Cells are pinned to their measured widths, because
 * a table of one row would otherwise size its columns differently.
 */
function copyRow(row: HTMLTableRowElement, container: HTMLElement): { outer: HTMLElement; table: HTMLTableElement | null } {
  const rowCopy = row.cloneNode(true) as HTMLTableRowElement;
  Array.from(row.cells).forEach((cell, index) => {
    const width = `${cell.getBoundingClientRect().width}px`;
    // Pinned on every side: a cell styled to fill the rest (`max-width: 0`)
    // would otherwise collapse in a table of one row
    Object.assign(rowCopy.cells[index].style, { boxSizing: 'border-box', width, minWidth: width, maxWidth: width });
  });

  let outer: HTMLElement = rowCopy;
  let table: HTMLTableElement | null = null;
  for (let node = row.parentElement; node && node !== container; node = node.parentElement) {
    const shell = node.cloneNode(false) as HTMLElement;
    shell.appendChild(outer);
    outer = shell;
    if (shell instanceof HTMLTableElement) table = shell;
  }
  // No duplicate ids while the copy is on screen
  outer.removeAttribute('id');
  outer.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  return { outer, table };
}

function placeOver(copy: HTMLElement, rowRect: DOMRect, container: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  Object.assign(copy.style, {
    position: 'absolute',
    top: `${rowRect.top - containerRect.top - container.clientTop}px`,
    left: `${rowRect.left - containerRect.left - container.clientLeft}px`,
    width: `${rowRect.width}px`,
    margin: '0',
    border: '0',
    padding: '0',
    overflow: 'visible',
    zIndex: '1',
  });
}

function followersOf(row: HTMLElement): Follower[] {
  const followers: Follower[] = [];
  for (let next = row.nextElementSibling; next instanceof HTMLElement; next = next.nextElementSibling) {
    followers.push({ row: next, top: next.getBoundingClientRect().top });
  }
  return followers;
}

/** Start a row where it was before the gap closed, and let it glide to rest. */
function glideIntoGap({ row, top }: Follower) {
  if (!row.isConnected) return;
  const shift = top - row.getBoundingClientRect().top;
  const running = glides.get(row);
  const from = (running?.offset.get() ?? 0) + shift;
  running?.controls.stop();
  running?.offset.destroy();
  glides.delete(row);
  if (from === 0) return;

  const offset = motionValue(from);
  const paint = () => {
    const y = offset.get();
    row.style.transform = y === 0 ? '' : `translateY(${y}px)`;
  };
  offset.on('change', paint);
  paint();
  const controls = animate(offset, 0, {
    type: 'spring',
    ...UI_SPRING,
    onComplete: () => {
      row.style.transform = '';
      glides.delete(row);
      offset.destroy();
    },
  });
  glides.set(row, { offset, controls });
}

function slideOut(copy: HTMLElement, width: number, rtl: boolean) {
  const travelled = motionValue(0);
  const direction = rtl ? -1 : 1;
  const paint = () => {
    const x = travelled.get();
    copy.style.transform = x === 0 ? '' : `translateX(${direction * x}px)`;
    copy.style.opacity = String(Math.max(0, 1 - x / width));
  };
  travelled.on('change', paint);
  paint();
  animate(travelled, width, {
    type: 'spring',
    ...UI_SPRING,
    onComplete: () => {
      copy.remove();
      travelled.destroy();
    },
  });
}

function fadeOut(copy: HTMLElement) {
  const presence = motionValue(1);
  const paint = () => {
    copy.style.opacity = String(presence.get());
  };
  presence.on('change', paint);
  paint();
  animate(presence, 0, {
    duration: REDUCED_MOTION_FADE_SECONDS,
    ease: 'easeOut',
    onComplete: () => {
      copy.remove();
      presence.destroy();
    },
  });
}

export function captureRowExit(row: HTMLTableRowElement, container: HTMLElement): RowExit | null {
  const rowRect = row.getBoundingClientRect();
  if (rowRect.width === 0 || rowRect.height === 0) return null;

  const rtl = row.closest('[dir]')?.getAttribute('dir') === 'rtl';
  const followers = followersOf(row);
  const { outer, table } = copyRow(row, container);
  if (table) table.style.tableLayout = 'fixed';
  outer.classList.add(ROW_EXIT_CLASS);
  hideFromEveryone(outer);
  placeOver(outer, rowRect, container);

  return {
    play({ reducedMotion }) {
      if (row.isConnected || !container.isConnected) return;
      container.appendChild(outer);
      if (reducedMotion) {
        fadeOut(outer);
        return;
      }
      slideOut(outer, rowRect.width, rtl);
      followers.forEach(glideIntoGap);
    },
  };
}
