import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

/**
 * A button that opens a menu of actions, with the keyboard behaviour of the
 * WAI-ARIA menu button pattern (MUT-15). Used by the sidebar's **New** menu
 * and the top bar's **Add** menu.
 *
 * - Opening (click, or ArrowDown / ArrowUp on the button) focuses the first
 *   / last item.
 * - ArrowDown / ArrowUp move between items and wrap; Home / End jump.
 * - Escape closes and gives focus back to the button; Tab closes and lets
 *   focus move on; a mousedown outside the button and the menu closes.
 *
 * Items are the menu's `[role="menuitem"]` descendants; the consumer renders
 * them and calls `close()` after running one (focus then goes wherever the
 * action takes it, usually a drawer).
 *
 * `kind: 'dialog'` (MUT-79) is the same button for a small non-modal panel of
 * information and controls, such as the top bar's exchange rate. The panel is
 * a `role="dialog"` that the consumer labels. Opening focuses its first
 * enabled control, or the panel itself when it has none. There is no
 * arrow-key movement. Tab moves between its controls and closes only when it
 * leaves past the last one (Shift+Tab: past the first). Escape and an outside
 * press behave as for a menu.
 */

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const CONTROL_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type FocusTarget = 'first' | 'last';

export type MenuButtonKind = 'menu' | 'dialog';

export interface MenuButtonOptions {
  kind?: MenuButtonKind;
}

export interface MenuButton {
  isOpen: boolean;
  close: () => void;
  buttonProps: {
    ref: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    'aria-haspopup': MenuButtonKind;
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
  };
  menuProps: {
    ref: RefObject<HTMLDivElement | null>;
    id: string;
    role: MenuButtonKind;
    tabIndex: -1 | undefined;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  };
}

export function useMenuButton({ kind = 'menu' }: MenuButtonOptions = {}): MenuButton {
  const isDialog = kind === 'dialog';
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<FocusTarget>('first');
  const menuId = useId();

  const items = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(isDialog ? CONTROL_SELECTOR : ITEM_SELECTOR) ?? [],
      ),
    [isDialog],
  );

  const focusItem = useCallback(
    (target: FocusTarget) => {
      const list = items();
      const next = target === 'last' ? list[list.length - 1] : list[0];
      (next ?? (isDialog ? menuRef.current : null))?.focus();
    },
    [items, isDialog],
  );

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (isOpen) focusItem(focusOnOpen.current);
  }, [isOpen, focusItem]);

  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const openAt = (target: FocusTarget) => {
    if (isOpen) {
      focusItem(target);
      return;
    }
    focusOnOpen.current = target;
    setIsOpen(true);
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (isDialog) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openAt(event.key === 'ArrowUp' ? 'last' : 'first');
  };

  // A dialog keeps Tab inside while there is a control to move to
  const tabLeavesDialog = (backwards: boolean) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    return backwards ? index <= 0 : index === list.length - 1;
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      if (!isDialog || tabLeavesDialog(event.shiftKey)) setIsOpen(false);
      return;
    }
    if (isDialog) return;
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const step: Record<string, () => number> = {
      ArrowDown: () => (index + 1) % list.length,
      ArrowUp: () => (index <= 0 ? list.length - 1 : index - 1),
      Home: () => 0,
      End: () => list.length - 1,
    };
    const next = step[event.key];
    if (!next) return;
    event.preventDefault();
    list[next()].focus();
  };

  return {
    isOpen,
    close,
    buttonProps: {
      ref: buttonRef,
      onClick: () => {
        focusOnOpen.current = 'first';
        setIsOpen((open) => !open);
      },
      onKeyDown: handleButtonKeyDown,
      'aria-haspopup': kind,
      'aria-expanded': isOpen,
      'aria-controls': isOpen ? menuId : undefined,
    },
    menuProps: {
      ref: menuRef,
      id: menuId,
      role: kind,
      tabIndex: isDialog ? -1 : undefined,
      onKeyDown: handleMenuKeyDown,
    },
  };
}
