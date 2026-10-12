import { afterEach, describe, expect, it } from 'vitest';
import { captureExitSnapshot } from '../exitSnapshot';

afterEach(() => {
  document.body.innerHTML = '';
});

function renderDrawerDom() {
  const shell = document.createElement('div');
  shell.innerHTML = `
    <div class="drawer-overlay"></div>
    <div class="drawer" role="dialog">
      <div class="drawer-body" id="body">
        <input id="amount" value="">
        <textarea id="notes"></textarea>
        <select id="currency"><option>USD</option><option>ILS</option></select>
        <input id="paid" type="checkbox">
      </div>
    </div>
    <footer id="after"></footer>`;
  document.body.append(shell);
  const overlay = shell.querySelector<HTMLElement>('.drawer-overlay')!;
  const panel = shell.querySelector<HTMLElement>('.drawer')!;
  return { shell, overlay, panel };
}

describe('captureExitSnapshot', () => {
  it('carries what the person typed and picked onto the clone', () => {
    const { overlay, panel } = renderDrawerDom();
    panel.querySelector<HTMLInputElement>('#amount')!.value = '150';
    panel.querySelector<HTMLTextAreaElement>('#notes')!.value = 'Logo, round two';
    panel.querySelector<HTMLSelectElement>('#currency')!.selectedIndex = 1;
    panel.querySelector<HTMLInputElement>('#paid')!.checked = true;

    const snapshot = captureExitSnapshot(overlay, panel);

    expect(snapshot.panel.querySelector<HTMLInputElement>('#amount')!.value).toBe('150');
    expect(snapshot.panel.querySelector<HTMLTextAreaElement>('#notes')!.value).toBe('Logo, round two');
    expect(snapshot.panel.querySelector<HTMLSelectElement>('#currency')!.selectedIndex).toBe(1);
    expect(snapshot.panel.querySelector<HTMLInputElement>('#paid')!.checked).toBe(true);
  });

  it('is hidden from assistive technology and from the pointer', () => {
    const { overlay, panel } = renderDrawerDom();
    const snapshot = captureExitSnapshot(overlay, panel);
    for (const clone of [snapshot.overlay, snapshot.panel]) {
      expect(clone.getAttribute('aria-hidden')).toBe('true');
      expect(clone.hasAttribute('inert')).toBe(true);
      expect(clone.style.pointerEvents).toBe('none');
    }
  });

  it('does not touch the document until attached', () => {
    const { overlay, panel } = renderDrawerDom();
    captureExitSnapshot(overlay, panel);
    expect(document.querySelectorAll('.drawer')).toHaveLength(1);
  });

  it('attaches where the originals were and restores the scroll position', () => {
    const { shell, overlay, panel } = renderDrawerDom();
    panel.querySelector<HTMLElement>('#body')!.scrollTop = 120;
    const snapshot = captureExitSnapshot(overlay, panel);
    overlay.remove();
    panel.remove();

    snapshot.attach();

    const children = Array.from(shell.children);
    expect(children.indexOf(snapshot.overlay)).toBe(0);
    expect(children.indexOf(snapshot.panel)).toBe(1);
    expect(children[2].id).toBe('after');
    expect(snapshot.panel.querySelector<HTMLElement>('#body')!.scrollTop).toBe(120);
  });

  it('appends at the end when its old neighbour has gone too', () => {
    const { shell, overlay, panel } = renderDrawerDom();
    const snapshot = captureExitSnapshot(overlay, panel);
    shell.querySelector('#after')!.remove();
    overlay.remove();
    panel.remove();

    snapshot.attach();

    expect(shell.lastElementChild).toBe(snapshot.panel);
  });

  it('removes both clones', () => {
    const { overlay, panel } = renderDrawerDom();
    const snapshot = captureExitSnapshot(overlay, panel);
    overlay.remove();
    panel.remove();
    snapshot.attach();

    snapshot.remove();

    expect(document.querySelector('.drawer')).toBeNull();
    expect(document.querySelector('.drawer-overlay')).toBeNull();
  });
});
