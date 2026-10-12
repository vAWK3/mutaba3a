import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  classifyDrag,
  closingDelta,
  displayOffset,
  exitDistance,
  isNoDragTarget,
  overlayOpacity,
  releaseTarget,
} from '../drawerGesture';
import { rubberband } from '../../../../lib/motion/physics';

const WIDTH = 480;

describe('classifyDrag', () => {
  it('waits until the pointer has moved 10px either way', () => {
    expect(DRAG_THRESHOLD_PX).toBe(10);
    expect(classifyDrag(9, 0)).toBe('pending');
    expect(classifyDrag(-9, 9)).toBe('pending');
  });

  it('is a horizontal drag once x leads past the threshold', () => {
    expect(classifyDrag(10, 3)).toBe('horizontal');
    expect(classifyDrag(-14, 12)).toBe('horizontal');
  });

  it('gives the gesture to scrolling once y leads or ties', () => {
    expect(classifyDrag(3, 10)).toBe('vertical');
    expect(classifyDrag(12, -12)).toBe('vertical');
  });
});

describe('closingDelta', () => {
  it('counts movement toward the right edge as closing in LTR', () => {
    expect(closingDelta(30, false)).toBe(30);
    expect(closingDelta(-30, false)).toBe(-30);
  });

  it('counts movement toward the left edge as closing in RTL', () => {
    expect(closingDelta(-30, true)).toBe(30);
    expect(closingDelta(30, true)).toBe(-30);
  });
});

describe('exitDistance', () => {
  it('is the panel width plus clearance for its shadow', () => {
    expect(exitDistance(WIDTH)).toBe(WIDTH + 32);
  });
});

describe('displayOffset', () => {
  it('follows the pointer 1:1 between open and closed', () => {
    expect(displayOffset(0, WIDTH)).toBe(0);
    expect(displayOffset(200, WIDTH)).toBe(200);
  });

  it('stops at the exit distance', () => {
    expect(displayOffset(10_000, WIDTH)).toBe(exitDistance(WIDTH));
  });

  it('rubber-bands past fully open', () => {
    expect(displayOffset(-100, WIDTH)).toBeCloseTo(-rubberband(100, WIDTH), 10);
    expect(displayOffset(-100, WIDTH)).toBeGreaterThan(-100);
  });
});

describe('releaseTarget', () => {
  it('dismisses a slow release past half the width', () => {
    expect(releaseTarget(260, 0, WIDTH)).toBe('dismiss');
  });

  it('stays open after a slow release short of half', () => {
    expect(releaseTarget(200, 0, WIDTH)).toBe('open');
  });

  it('stays open exactly at half', () => {
    expect(releaseTarget(WIDTH / 2, 0, WIDTH)).toBe('open');
  });

  it('dismisses a flick toward the edge from a short offset', () => {
    expect(releaseTarget(60, 800, WIDTH)).toBe('dismiss');
  });

  it('stays open after a flick back toward open from past half', () => {
    expect(releaseTarget(300, -800, WIDTH)).toBe('open');
  });
});

describe('overlayOpacity', () => {
  it('is fully dim with the panel open and clear with it closed', () => {
    expect(overlayOpacity(0, WIDTH)).toBe(1);
    expect(overlayOpacity(WIDTH, WIDTH)).toBe(0);
  });

  it('tracks the progress in between', () => {
    expect(overlayOpacity(WIDTH / 2, WIDTH)).toBeCloseTo(0.5, 10);
  });

  it('stays within 0..1 past either end', () => {
    expect(overlayOpacity(-40, WIDTH)).toBe(1);
    expect(overlayOpacity(WIDTH + 32, WIDTH)).toBe(0);
  });
});

describe('isNoDragTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function panelWith(html: string): HTMLElement {
    const panel = document.createElement('div');
    panel.innerHTML = html;
    document.body.append(panel);
    return panel;
  }

  it('refuses form fields and editable content', () => {
    const panel = panelWith(
      '<input id="i"><textarea id="t"></textarea><select id="s"><option>a</option></select><div contenteditable="true"><span id="e">x</span></div>',
    );
    for (const id of ['i', 't', 's', 'e']) {
      expect(isNoDragTarget(panel.querySelector(`#${id}`), panel)).toBe(true);
    }
  });

  it('refuses anything inside [data-drawer-no-drag]', () => {
    const panel = panelWith('<div data-drawer-no-drag><p id="p">chart</p></div>');
    expect(isNoDragTarget(panel.querySelector('#p'), panel)).toBe(true);
  });

  it('refuses a region that scrolls horizontally', () => {
    const panel = panelWith('<div id="wide" style="overflow-x: auto"><span id="cell">1</span></div>');
    const wide = panel.querySelector<HTMLElement>('#wide')!;
    Object.defineProperty(wide, 'scrollWidth', { value: 900 });
    Object.defineProperty(wide, 'clientWidth', { value: 400 });
    expect(isNoDragTarget(panel.querySelector('#cell'), panel)).toBe(true);
  });

  it('accepts a button, plain text and a region that fits', () => {
    const panel = panelWith('<button id="b">Save</button><p id="p">Text</p><div style="overflow-x: auto"><span id="c">1</span></div>');
    expect(isNoDragTarget(panel.querySelector('#b'), panel)).toBe(false);
    expect(isNoDragTarget(panel.querySelector('#p'), panel)).toBe(false);
    expect(isNoDragTarget(panel.querySelector('#c'), panel)).toBe(false);
  });

  it('refuses a target that is not an element', () => {
    const panel = panelWith('<p>Text</p>');
    expect(isNoDragTarget(null, panel)).toBe(true);
  });
});
