import { afterEach, describe, expect, it } from 'vitest';
import { focusablesWithin } from '../focusable';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusablesWithin', () => {
  it('lists enabled controls in document order', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <button id="a">A</button>
      <a id="b" href="#x">B</a>
      <input id="c">
      <select id="d"><option>1</option></select>
      <textarea id="e"></textarea>
      <div id="f" tabindex="0">F</div>`;
    document.body.append(root);

    expect(focusablesWithin(root).map((el) => el.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('skips disabled controls, tabindex -1, hidden inputs and [hidden] subtrees', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <button id="ok">OK</button>
      <button id="off" disabled>Off</button>
      <input id="secret" type="hidden">
      <div id="programmatic" tabindex="-1">P</div>
      <div hidden><button id="tucked">Tucked</button></div>`;
    document.body.append(root);

    expect(focusablesWithin(root).map((el) => el.id)).toEqual(['ok']);
  });
});
