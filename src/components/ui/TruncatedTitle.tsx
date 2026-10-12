/**
 * TruncatedTitle (MUT-62)
 *
 * A record's title in a table row: one line, cut with an ellipsis, and a
 * button that opens the record, so a keyboard can reach it. When the text is
 * cut, hovering or focusing it shows the whole title in a tooltip.
 *
 * The tooltip is portalled to <body> because `.data-table` scrolls and would
 * clip it. It follows WCAG 1.4.13: the pointer can move onto it (it waits a
 * moment before hiding), Escape dismisses it, and it stays until hover and
 * focus leave. It is aria-hidden: the button's accessible name is already the
 * full title, so a screen reader would only hear it twice.
 *
 * Usage:
 *   <td className="work-cell">
 *     <TruncatedTitle title={row.title} onOpen={() => openEntry(row.id)} />
 *   </td>
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { nudgeInside } from '../layout/popoverPosition';
import { cn } from '../../lib/utils';
import './TruncatedTitle.css';

/** Space between the title and its tooltip, in px */
const TOOLTIP_GAP = 4;
/** How close the tooltip may come to the window's edges, in px */
const EDGE_MARGIN = 8;
/** How long the tooltip stays after the pointer leaves, so it can be reached */
const HIDE_GRACE_MS = 150;

interface Placement {
  top: number;
  left?: number;
  right?: number;
}

export interface TruncatedTitleProps {
  /** The full title; shown on one line, cut when it doesn't fit */
  title: string;
  /** Opens the record the title names (the row's drawer) */
  onOpen: () => void;
  className?: string;
}

const isCut = (text: HTMLElement) => text.scrollWidth > text.clientWidth;

/** Below the title, from its inline start: its left edge, or its right edge in a right-to-left page. */
function placeBelow(anchor: DOMRect): Placement {
  const top = anchor.bottom + TOOLTIP_GAP;
  return document.documentElement.dir === 'rtl'
    ? { top, right: window.innerWidth - anchor.right }
    : { top, left: anchor.left };
}

export function TruncatedTitle({ title, onOpen, className }: TruncatedTitleProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const cancelHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  }, []);

  const hide = useCallback(() => {
    cancelHide();
    setPlacement(null);
  }, [cancelHide]);

  const hideSoon = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(hide, HIDE_GRACE_MS);
  };

  const show = () => {
    cancelHide();
    const button = buttonRef.current;
    const text = textRef.current;
    if (!button || !text || !isCut(text)) return;
    setPlacement(placeBelow(button.getBoundingClientRect()));
  };

  const open = (event: MouseEvent) => {
    // The row opens the same record on click; this opens it once
    event.stopPropagation();
    hide();
    onOpen();
  };

  // Escape dismisses it wherever focus is; a scroll or resize would leave it behind
  useEffect(() => {
    if (!placement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [placement, hide]);

  // Before paint: open above the title when there's no room below, and keep it inside the window
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const button = buttonRef.current;
    if (!placement || !tooltip || !button) return;
    const box = tooltip.getBoundingClientRect();
    if (box.bottom > window.innerHeight - EDGE_MARGIN) {
      const above = button.getBoundingClientRect().top - TOOLTIP_GAP - box.height;
      tooltip.style.top = `${Math.max(EDGE_MARGIN, above)}px`;
    }
    const dx = nudgeInside(box, { left: 0, right: window.innerWidth }, EDGE_MARGIN);
    tooltip.style.translate = dx === 0 ? '' : `${dx}px 0`;
  }, [placement]);

  useEffect(() => cancelHide, [cancelHide]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cn('truncated-title', className)}
        onClick={open}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hide}
      >
        <span ref={textRef} className="truncated-title-text" dir="auto">
          {title}
        </span>
      </button>
      {placement &&
        createPortal(
          <div
            ref={tooltipRef}
            className="truncated-title-tooltip"
            dir="auto"
            aria-hidden="true"
            style={{ top: placement.top, left: placement.left, right: placement.right }}
            onMouseEnter={cancelHide}
            onMouseLeave={hideSoon}
            onClick={open}
          >
            {title}
          </div>,
          document.body
        )}
    </>
  );
}
