import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDrawerFocus } from './drawer/useDrawerFocus';
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
 * It renders outside the app, at the end of `<body>`, and while it is open every other child of
 * `<body>` is `inert` and `aria-hidden`: the shell, an open drawer, a toast's Undo, all of it stays
 * mounted (a draft survives) but can't be reached, clicked or read. Escape is swallowed before any
 * document listener hears it, so a drawer underneath never closes. Focus comes in on open, wraps at
 * the ends, and goes back to what had it once the app is reachable again (`useDrawerFocus`).
 * There is no close button and the backdrop does nothing: the content decides when it's done.
 */
export function BlockingDialog({ labelledBy, children, className }: BlockingDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useDrawerFocus(panelRef);

  // Before paint, so nothing behind is reachable for even a frame. The cleanup runs before
  // useDrawerFocus's queued focus return, so focus lands on an element that is no longer inert.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const hidden = Array.from(document.body.children).filter((element): element is HTMLElement => element !== root && element instanceof HTMLElement);
    // The attributes, not the `inert` property: the same in browsers, and what jsdom can see
    const before = hidden.map((element) => ({ element, inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') }));
    for (const element of hidden) {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const { element, inert, ariaHidden } of before) {
        restore(element, 'inert', inert);
        restore(element, 'aria-hidden', ariaHidden);
      }
    };
  }, []);

  useEffect(() => {
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

function restore(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}
