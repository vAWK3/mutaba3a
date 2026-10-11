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

export function LockIcon() {
  return (
    <svg className="hp-banner-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
    </svg>
  );
}
