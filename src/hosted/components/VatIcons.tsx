import type { SVGProps } from 'react';
import { useOptionalDirection } from '../../lib/i18n/core';

/**
 * MUT-783: the VAT period icon set (Claude Design, 2026-11-28): 24 px, 2 px stroke, `currentColor`, the nuqta as the
 * one filled dot. The two that point (a receipt on its way to the folder, a speech bubble) ship a mirrored drawing for
 * a right-to-left page, drawn into the SVG, never flipped in CSS (DESIGN.md).
 */
type Props = Omit<SVGProps<SVGSVGElement>, 'children'>;
const base = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
const MIRROR = 'matrix(-1 0 0 1 24 0)';

export function VatPeriodIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 5h12a3 3 0 0 1 3 3v7l-6 6H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" />
      <path d="M15 21v-3a3 3 0 0 1 3-3h3" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="8.5" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StateWaitingIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a9 9 0 1 1-4.2-7.6" />
      <path d="M12 7.5V12l3 2" />
      <circle cx="19.6" cy="6.3" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StateConfirmedIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a9 9 0 1 1-4.2-7.6" />
      <path d="M8 12l3 3 5-6" />
      <circle cx="19.6" cy="6.3" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StateMoreNeededIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 3h11v18l-1.8-1.2-1.9 1.2-1.8-1.2-1.8 1.2-1.9-1.2L4 21z" />
      <path d="M7.5 8h4M7.5 12h2" />
      <path d="M19 13v6M16 16h6" />
      <circle cx="11.5" cy="15.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StateClientSentIcon(props: Props) {
  const rtl = useOptionalDirection() === 'rtl';
  return (
    <svg {...base} {...props}>
      <g {...(rtl ? { transform: MIRROR } : {})}>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <path d="M6.5 15v.5a2.5 2.5 0 0 0 2.5 2.5h3M10.5 15.5 13 18l-2.5 2.5" />
        <path d="M14 11h2.5l1.5 2h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z" />
        <circle cx="6.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

export function AskMoreIcon(props: Props) {
  const rtl = useOptionalDirection() === 'rtl';
  return (
    <svg {...base} {...props}>
      <g {...(rtl ? { transform: MIRROR } : {})}>
        <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <path d="M12 7.5v6M9 10.5h6" />
      </g>
    </svg>
  );
}
