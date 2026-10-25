import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';

/**
 * The You page's rows (MUT-425): full-width, at least 44px, one group per box (wireframe round 4, variation 3).
 * Plain buttons, links and switches, not menu items: the page is a page, so the keyboard is the browser's own.
 */

function RowText({ label, sub }: { label: ReactNode; sub?: ReactNode }) {
  return (
    <span className="hp-you-row-text">
      <span className="hp-you-row-label">{label}</span>
      {sub && <small>{sub}</small>}
    </span>
  );
}

export function RowGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="hp-you-group" aria-label={label}>
      {label && <h2 className="hp-you-group-label">{label}</h2>}
      <div className="hp-you-box">{children}</div>
    </section>
  );
}

interface RowButtonProps {
  label: ReactNode;
  sub?: ReactNode;
  lead?: ReactNode;
  tail?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Focusable but inert, so it can still say why (New profile at the cap). */
  inert?: boolean;
  current?: boolean;
  tone?: 'danger' | 'action';
}

export function RowButton({ label, sub, lead, tail, onClick, disabled, inert, current, tone }: RowButtonProps) {
  return (
    <button
      type="button"
      className={`hp-you-row press${tone ? ` hp-you-row--${tone}` : ''}`}
      aria-current={current || undefined}
      aria-disabled={inert || undefined}
      disabled={disabled}
      onClick={() => {
        if (!inert) onClick();
      }}
    >
      {lead}
      <RowText label={label} sub={sub} />
      {tail}
    </button>
  );
}

/** A link out (Terms, Malafat, the stores): always a new tab, and says so to a screen reader. */
export function RowLink({ label, sub, href }: { label: ReactNode; sub?: ReactNode; href: string }) {
  const t = useT();
  return (
    <a className="hp-you-row press" href={href} target="_blank" rel="noopener noreferrer">
      <RowText label={label} sub={sub} />
      <span className="sr-only">{t('common.opensInNewTab')}</span>
      <span className="hp-you-row-tail" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

export function RowSwitch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="hp-you-row press" onClick={onToggle}>
      <RowText label={label} />
      <span className="hp-you-switch" aria-hidden="true" />
    </button>
  );
}

/**
 * A link to another portal page (MUT-424's one-level-in rows): a real link, so it deep-links and Back works. The ›
 * is bidi-mirrored by the browser in Arabic, so it needs no CSS flip (that would point it backwards).
 */
export function RowNavLink({ label, sub, to }: { label: ReactNode; sub?: ReactNode; to: string }) {
  return (
    <Link className="hp-you-row press" to={to}>
      <RowText label={label} sub={sub} />
      <span className="hp-you-row-tail" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

/** A row that names something not yet actionable (an app with no store listing yet). */
export function RowNote({ label }: { label: ReactNode }) {
  return (
    <p className="hp-you-row hp-you-row--note">
      <RowText label={label} />
    </p>
  );
}
