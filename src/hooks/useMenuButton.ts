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
 */

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

type FocusTarget = 'first' | 'last';

export interface MenuButton {
  isOpen: boolean;
  close: () => void;
  buttonProps: {
    ref: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
  };
  menuProps: {
    ref: RefObject<HTMLDivElement | null>;
    id: string;
    role: 'menu';
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  };
}

export function useMenuButton(): MenuButton {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<FocusTarget>('first');
  const menuId = useId();

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    [],
  );

  const focusItem = useCallback(
    (target: FocusTarget) => {
      const list = items();
      (target === 'last' ? list[list.length - 1] : list[0])?.focus();
    },
    [items],
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
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openAt(event.key === 'ArrowUp' ? 'last' : 'first');
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      setIsOpen(false);
      return;
    }
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
      'aria-haspopup': 'menu',
      'aria-expanded': isOpen,
      'aria-controls': isOpen ? menuId : undefined,
    },
    menuProps: {
      ref: menuRef,
      id: menuId,
      role: 'menu',
      onKeyDown: handleMenuKeyDown,
    },
  };
}
