import { useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { focusablesWithin } from '../../../lib/dom/focusable';

/**
 * Keyboard focus for a modal drawer (MUT-80, D13).
 *
 * - The element focused when the drawer first renders is its trigger.
 * - After mount, focus moves to the dialog unless a field took it (`autoFocus`).
 * - Tab and Shift+Tab wrap at the ends. This is a keydown handler on the panel,
 *   not a document-wide focus guard, so a modal opened on top keeps its focus.
 * - When the drawer really unmounts (not StrictMode's rehearsal), focus goes
 *   back to the trigger, unless something else has taken it meanwhile.
 */
export function useDrawerFocus(panelRef: RefObject<HTMLElement | null>) {
  const [trigger] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [panelRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      if (!panel?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        if (panel.isConnected) return;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, [panelRef, trigger]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const panel = panelRef.current;
      if (event.key !== 'Tab' || !panel) return;
      const items = focusablesWithin(panel);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first) {
        event.preventDefault();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [panelRef],
  );

  return { onKeyDown };
}
