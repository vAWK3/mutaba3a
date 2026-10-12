import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { captureRowExit, ROW_EXIT_CLASS } from '../rowExit';

// MUT-82 (D6): a row that a payment settled leaves its list the way a drawer
// closes (ADR-044): the state change is immediate, and an inert copy of its
// last frame plays the exit. jsdom lays nothing out, so these tests give the
// elements boxes; without them nothing is captured (no layout, no motion).

const SETTLE = { timeout: 2000 };
const ROW_HEIGHT = 50;
const CELL_WIDTHS = [200, 100, 80];

type Box = { top: number; left: number; width: number; height: number };
const boxes = new Map<Element, Box>();

function giveBox(element: Element, box: Box) {
  boxes.set(element, box);
}

function rect({ top, left, width, height }: Box): DOMRect {
  return { top, left, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

/** A section holding a three-row table, laid out like Home's Needs attention. */
function buildList() {
  const container = document.createElement('section');
  container.innerHTML = `
    <h2>Needs Attention</h2>
    <div class="data-table home-table">
      <table>
        <tbody>
          <tr id="r1"><td><a id="link-1" href="/clients/a">Acme</a></td><td>$100</td><td><button>Record Payment</button></td></tr>
          <tr id="r2"><td>Beta</td><td>$200</td><td><button>Record Payment</button></td></tr>
          <tr id="r3"><td>Gamma</td><td>$300</td><td><button>Record Payment</button></td></tr>
        </tbody>
      </table>
    </div>`;
  document.body.appendChild(container);
  giveBox(container, { top: 100, left: 50, width: 400, height: 300 });
  const rows = Array.from(container.querySelectorAll('tr'));
  rows.forEach((row, index) => {
    giveBox(row, { top: 150 + index * ROW_HEIGHT, left: 60, width: 380, height: ROW_HEIGHT });
    Array.from(row.cells).forEach((cell, cellIndex) =>
      giveBox(cell, { top: 150 + index * ROW_HEIGHT, left: 60, width: CELL_WIDTHS[cellIndex], height: ROW_HEIGHT }),
    );
  });
  return { container, rows };
}

/** The list after the first row has left: the others moved up one row. */
function removeFirst(rows: HTMLTableRowElement[]) {
  rows[0].remove();
  rows.slice(1).forEach((row, index) => giveBox(row, { ...boxes.get(row)!, top: 150 + index * ROW_HEIGHT }));
}

function translate(element: HTMLElement, axis: 'X' | 'Y'): number {
  const match = new RegExp(`translate${axis}\\((-?[\\d.]+)px\\)`).exec(element.style.transform);
  return match ? Number(match[1]) : 0;
}

const overlayIn = (container: HTMLElement) => container.querySelector<HTMLElement>(`.${ROW_EXIT_CLASS}`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('captureRowExit', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rect(boxes.get(this) ?? { top: 0, left: 0, width: 0, height: 0 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    boxes.clear();
    document.body.innerHTML = '';
  });

  it('captures nothing without layout', () => {
    const { container, rows } = buildList();
    boxes.delete(rows[0]);

    expect(captureRowExit(rows[0], container)).toBeNull();
  });

  it('lays an inert, hidden copy over where the row was, with its cells at their widths', () => {
    const { container, rows } = buildList();
    const exit = captureRowExit(rows[0], container)!;
    removeFirst(rows);

    exit.play({ reducedMotion: false });

    const overlay = overlayIn(container)!;
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveAttribute('inert');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(overlay.style.position).toBe('absolute');
    expect(overlay.style.top).toBe('50px');
    expect(overlay.style.left).toBe('10px');
    expect(overlay.style.width).toBe('380px');
    // The table wrapper's classes come along, so the cells keep their styles
    expect(overlay.classList.contains('data-table')).toBe(true);
    const cells = Array.from(overlay.querySelectorAll('td'));
    expect(cells.map((cell) => cell.style.width)).toEqual(['200px', '100px', '80px']);
    expect(cells[0]).toHaveTextContent('Acme');
    // No duplicate ids while the copy is on screen
    expect(overlay.querySelector('[id]')).toBeNull();
  });

  it('slides the copy toward the inline end while it fades, then removes it', async () => {
    const { container, rows } = buildList();
    const exit = captureRowExit(rows[0], container)!;
    removeFirst(rows);

    exit.play({ reducedMotion: false });
    const overlay = overlayIn(container)!;
    await sleep(80);

    expect(translate(overlay, 'X')).toBeGreaterThan(0);
    expect(Number(overlay.style.opacity)).toBeLessThan(1);
    await waitFor(() => expect(overlayIn(container)).toBeNull(), SETTLE);
  });

  it('slides toward the left in a right-to-left document', async () => {
    const { container, rows } = buildList();
    container.setAttribute('dir', 'rtl');
    const exit = captureRowExit(rows[0], container)!;
    removeFirst(rows);

    exit.play({ reducedMotion: false });
    await sleep(80);

    expect(translate(overlayIn(container)!, 'X')).toBeLessThan(0);
  });

  it('starts the rows after it where they were, and lets them glide up to rest', async () => {
    const { container, rows } = buildList();
    const exit = captureRowExit(rows[0], container)!;
    removeFirst(rows);

    exit.play({ reducedMotion: false });

    expect(translate(rows[1], 'Y')).toBe(ROW_HEIGHT);
    expect(translate(rows[2], 'Y')).toBe(ROW_HEIGHT);
    await waitFor(() => {
      expect(rows[1].style.transform).toBe('');
      expect(rows[2].style.transform).toBe('');
    }, SETTLE);
  });

  it('only fades under reduced motion, and leaves the other rows where they are', async () => {
    const { container, rows } = buildList();
    const exit = captureRowExit(rows[0], container)!;
    removeFirst(rows);

    exit.play({ reducedMotion: true });
    const overlay = overlayIn(container)!;
    await sleep(60);

    expect(overlay.style.transform).toBe('');
    expect(Number(overlay.style.opacity)).toBeLessThan(1);
    expect(rows[1].style.transform).toBe('');
    await waitFor(() => expect(overlayIn(container)).toBeNull(), SETTLE);
  });

  it('plays nothing while the row is still in the document (StrictMode rehearsal)', () => {
    const { container, rows } = buildList();
    const exit = captureRowExit(rows[0], container)!;

    exit.play({ reducedMotion: false });

    expect(overlayIn(container)).toBeNull();
    expect(rows[1].style.transform).toBe('');
  });

  it('plays nothing once its list has left the document (navigated away)', () => {
    const { container, rows } = buildList();
    const exit = captureRowExit(rows[0], container)!;
    container.remove();

    exit.play({ reducedMotion: false });

    expect(overlayIn(container)).toBeNull();
    expect(rows[1].style.transform).toBe('');
  });
});
