import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDrawerFocus } from './drawer/useDrawerFocus';
import { openBlocking } from './blockingLayer';
import './BlockingDialog.css';

export interface BlockingDialogProps {
  /** Id of the heading that names the dialog. */
  labelledBy: string;
  children: ReactNode;
  /** Extra classes for the panel (the portal's card look). */
  className?: string;
}

/**
 * A dialog that must be answered before anything else (MUT-346: terms that changed mid-session).
 * It renders outside the app, at the end of `<body>`, and while it is open everything else on the
 * page is `inert` and `aria-hidden` and the page doesn't scroll (`blockingLayer`): the shell, an open
 * drawer, a toast's Undo, all of it stays mounted (a draft survives) but can't be reached, clicked or read. Escape is swallowed before any
 * document listener hears it, so a drawer underneath never closes. Focus comes in on open, wraps at
 * the ends (`useDrawerFocus`), and goes back to what had it once the app is reachable again.
 * There is no close button and the backdrop does nothing: the content decides when it's done.
 */
export function BlockingDialog({ labelledBy, children, className }: BlockingDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useDrawerFocus(panelRef);
  // What had focus when the dialog first rendered, before anything behind went inert
  const [trigger] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  // Before paint, so nothing behind is reachable for even a frame.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    // Focus leaves the app before it is hidden, so nothing focused is ever inert or aria-hidden, even for a frame
    panel.focus({ preventScroll: true });
    const close = openBlocking({ root, panel });
    return () => {
      close();
      // Focus goes back once the app is reachable again. Unlike a drawer, the dialog's own button is often
      // what closes it, and it disables itself while saving: the browser then drops focus to <body> before
      // the dialog goes, so this returns focus whenever nothing else holds it, not only when the dialog did.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, [trigger]);

  // From the first frame: a passive effect could leave Escape to the drawer underneath for a tick
  useLayoutEffect(() => {
    function swallowEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    window.addEventListener('keydown', swallowEscape, { capture: true });
    return () => window.removeEventListener('keydown', swallowEscape, { capture: true });
  }, []);

  return createPortal(
    <div ref={rootRef} className="blocking-dialog-root">
      <div className="blocking-dialog-backdrop" />
      <div ref={panelRef} className={['blocking-dialog', className].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

