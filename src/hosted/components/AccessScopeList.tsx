import { useT } from '../../lib/i18n/core';

/**
 * MUT-561: the one promise of what a shared reader can do (ADR-245): sees, can download, can't change, doesn't see the
 * rest. One copy, so the Sharing page, its invite drawer and MUT-562's invite page never word it differently.
 */
const POINTS = ['hosted.accessScope.sees', 'hosted.accessScope.download', 'hosted.accessScope.cannotChange', 'hosted.accessScope.cannotSeeOther'] as const;

export function AccessScopeList({ className }: { className?: string }) {
  const t = useT();
  return (
    <ul className={['hp-access-scope', className].filter(Boolean).join(' ')} aria-label={t('hosted.accessScope.label')}>
      {POINTS.map((key, index) => (
        // The first two say what they can do, the last two what they can't (wireframe B2's ✓ and ✕)
        <li key={key} data-can={index < 2 || undefined}>
          {t(key)}
        </li>
      ))}
    </ul>
  );
}
