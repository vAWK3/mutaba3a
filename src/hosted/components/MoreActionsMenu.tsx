import type { KeyboardEvent, ReactNode } from 'react';
import { usePopover } from '../shell/usePopover';

/**
 * A "⋯" button and the menu it opens (MUT-503 D4, DR5/DR7; first written inline for a group's actions, 21A). The
 * menu grows from the button's end (`hp-grow-from-end`); ↑/↓, Home and End move between items; Escape or an outside
 * press closes it and returns focus to the button (usePopover). Choosing an item closes it first, then acts.
 */
export interface MoreAction {
  label: string;
  onSelect: () => void;
}

export interface MoreActionsMenuProps {
  /** The button's and the menu's accessible name ("More actions"). */
  label: string;
  actions: readonly MoreAction[];
  /** The button's look; the group page's is a small secondary button, a receipt card's a glass chip. */
  buttonClassName: string;
  /** Extra placement for the panel (`hp-group-menu`, `hp-receipt-menu`). */
  panelClassName?: string;
  /** What the button shows; "⋯" by default. */
  children?: ReactNode;
}

export function MoreActionsMenu({ label, actions, buttonClassName, panelClassName, children = '⋯' }: MoreActionsMenuProps) {
  const { open, close, toggle, buttonRef, panelRef } = usePopover();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: (at + 1) % items.length, ArrowUp: (at - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (to === undefined || items.length === 0) return;
    event.preventDefault();
    items[to]?.focus();
  };

  return (
    <>
      <button ref={buttonRef} type="button" className={`${buttonClassName} press`} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={toggle}>
        {children}
      </button>
      {open && (
        <div ref={panelRef} className={`hp-popover hp-grow-from-end ${panelClassName ?? ''}`} role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="hp-menu-item press"
              onClick={() => {
                close(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
