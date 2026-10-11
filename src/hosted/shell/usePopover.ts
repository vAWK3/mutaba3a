import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A button-anchored panel (profile switcher, account menu): Escape and an
 * outside press close it and return focus to the button; opening focuses the
 * first menu item. The app's `useMenuButton` lives in `src/hooks`, which the
 * portal may not import (hosted-portal.md §8), hence this small twin.
 */
export function usePopover<B extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<B>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return { open, setOpen, close, toggle: () => setOpen((value) => !value), buttonRef, panelRef };
}
