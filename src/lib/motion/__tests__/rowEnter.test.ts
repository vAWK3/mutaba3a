import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { playRowEnter } from '../rowEnter';

// MUT-268: Undo brings a row back the way it left. jsdom lays nothing out, so the row gets a box.

function rowIn(dir: 'ltr' | 'rtl', width = 400) {
  const host = document.createElement('div');
  host.setAttribute('dir', dir);
  host.innerHTML = '<table><tbody><tr><td>Dead Sea day pass</td></tr></tbody></table>';
  document.body.appendChild(host);
  const row = host.querySelector('tr')!;
  row.getBoundingClientRect = () => ({ width, height: 40, top: 0, left: 0, right: width, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  return row;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('playRowEnter', () => {
  it('starts toward the inline end, transparent, and settles in its slot', async () => {
    const row = rowIn('ltr');
    playRowEnter(row, { reducedMotion: false });
    expect(row.style.transform).toBe('translateX(120px)');
    expect(row.style.opacity).toBe('0');
    await waitFor(() => expect([row.style.transform, row.style.opacity]).toEqual(['', '']), { timeout: 2000 });
  });

  it('comes from the left in right-to-left', () => {
    const row = rowIn('rtl');
    playRowEnter(row, { reducedMotion: false });
    expect(row.style.transform).toBe('translateX(-120px)');
  });

  it('only fades under reduced motion', async () => {
    const row = rowIn('ltr');
    playRowEnter(row, { reducedMotion: true });
    expect(row.style.transform).toBe('');
    expect(row.style.opacity).toBe('0');
    await waitFor(() => expect(row.style.opacity).toBe(''), { timeout: 2000 });
  });

  it('does nothing without layout', () => {
    const row = rowIn('ltr', 0);
    playRowEnter(row, { reducedMotion: false });
    expect(row.style.transform).toBe('');
    expect(row.style.opacity).toBe('');
  });
});
