/**
 * @vitest-environment jsdom
 *
 * The business picker the Add menus show under "All businesses" (MUT-89). It
 * opens under the item that asked, and stays inside the window: the top bar's
 * Add menu sits at the inline end, where a picker aligned to its item would
 * run past the edge (found in the MUT-89 browser check).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileQuickPicker } from '../ProfileQuickPicker';
import type { BusinessProfile } from '../../../types';

vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }));

const STAMP = '2026-01-01T00:00:00Z';
const studio: BusinessProfile = { id: 'p1', name: 'Studio', createdAt: STAMP, updatedAt: STAMP };

const rect = (left: number, width: number, top = 0, height = 30) =>
  ({ left, right: left + width, width, top, bottom: top + height, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function renderPickerAt(anchorLeft: number, pickerWidth: number) {
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => rect(anchorLeft, 120, 10);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('profile-quick-picker') ? rect(anchorLeft, pickerWidth, 44, 120) : rect(0, 0);
  });
  render(<ProfileQuickPicker anchor={anchor} profiles={[studio]} onSelect={() => {}} onClose={() => {}} />);
  return screen.getByRole('listbox');
}

describe('ProfileQuickPicker placement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens under its item, unshifted, when it fits', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    const picker = renderPickerAt(400, 216);

    expect(picker.style.left).toBe('400px');
    expect(picker.style.translate).toBe('');
  });

  it('shifts back inside the window when it would run past the inline end', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    const picker = renderPickerAt(900, 216);

    // 8 px from the edge: 1024 - 8 - (900 + 216) = -100
    expect(picker.style.translate).toBe('-100px 0');
  });
});

describe('ProfileQuickPicker keyboard and anchoring (MUT-89)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderOpenPicker({ returnFocus }: { returnFocus?: HTMLElement } = {}) {
    // The asking menu item has already left the page (its menu closed)
    const anchor = document.createElement('button');
    const onClose = vi.fn();
    const utils = render(
      <ProfileQuickPicker
        anchor={anchor}
        anchorRect={rect(300, 120, 40)}
        returnFocus={returnFocus}
        profiles={[studio]}
        onSelect={() => {}}
        onClose={onClose}
      />
    );
    return { ...utils, anchor, onClose };
  }

  it('places itself from where the item was when it opened, though the item is gone', () => {
    const picker = renderOpenPicker().container.querySelector('.profile-quick-picker') as HTMLElement;
    expect(picker.style.left).toBe('300px');
    expect(picker.style.top).toBe('74px');
  });

  it('moves focus to its first business when it opens', () => {
    renderOpenPicker();
    expect(screen.getByRole('option', { name: /Studio/ })).toHaveFocus();
  });

  it('gives focus back to the menu button on Escape', async () => {
    const menuButton = document.createElement('button');
    document.body.appendChild(menuButton);
    const { onClose } = renderOpenPicker({ returnFocus: menuButton });

    await new Promise((resolve) => setTimeout(resolve, 0)); // its key listener is attached after the opening click
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
    expect(menuButton).toHaveFocus();
    menuButton.remove();
  });
});

