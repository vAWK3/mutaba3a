/** The few glyphs the portal draws (16 px, currentColor). */

export function InfoIcon() {
  return (
    <svg className="hp-banner-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 10.5h-1.5V7h1.5v4.5ZM8 5.75a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg className="hp-banner-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 10.5h-1.5V10h1.5v1.5Zm0-3h-1.5v-4h1.5v4Z" />
    </svg>
  );
}

/**
 * MUT-115 (DR9): the passkey mark at the start of "Sign in with a passkey": a person and a key, in currentColor,
 * decorative (the label says it), and never mirrored in RTL. A drawn stand-in for the FIDO Alliance's passkey symbol
 * until its official artwork is added to the brand kit (TD in .claude/TECH_DEBT.md).
 */
export function PasskeyIcon() {
  return (
    <svg className="hp-passkey-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="7" r="4" />
      <path d="M2 19.5C2 15.9 5.1 13 9 13c1.3 0 2.5.3 3.5.9a5.5 5.5 0 0 0-.5 2.3c0 1.3.4 2.5 1.2 3.4H3a1 1 0 0 1-1-.1Z" />
      <path d="M17.5 12a3.5 3.5 0 0 0-1 6.86V22l1.25 1 1.25-1v-1l-.75-.75.75-.75v-.64A3.5 3.5 0 0 0 17.5 12Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="hp-banner-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
    </svg>
  );
}
