/**
 * MUT-768 (accountant channel, DR-11): the six-digit claim code the accountant says out loud, shown big and in two
 * groups ("481 702"). Display only: no copy button, the code is spoken, never sent. It stays left-to-right in a right-
 * to-left page, and a screen reader hears the digits one at a time. Extended by MUT-770 (a live region for Activating).
 */
export function CodeReveal({ code, label }: { code: string; label: string }) {
  const digits = code.replace(/\D/g, '');
  const groups = [digits.slice(0, 3), digits.slice(3)].filter((group) => group !== '');
  return (
    <div className="hp-code-reveal" role="img" aria-label={`${label}: ${digits.split('').join(' ')}`} data-testid="code-reveal">
      {groups.map((group, index) => (
        <span key={index} aria-hidden="true">
          {group}
        </span>
      ))}
    </div>
  );
}
