import { Link } from '@tanstack/react-router';
import { useT } from '../../../lib/i18n/core';

/**
 * MUT-562 (layout C): the desk's own pill, "Client books" (lit) | "My books". My books goes Home, which opens the
 * person's own profile as it always does.
 */
export function DeskPill() {
  const t = useT();
  return (
    <nav className="hp-pill hp-glass" aria-label={t('hosted.clientBooks.deskNav')}>
      <Link to="/client-books" className="hp-tab-on" aria-current="page" activeOptions={{ exact: false }}>
        {t('hosted.clientBooks.title')}
      </Link>
      <Link to="/">{t('hosted.clientBooks.myBooks')}</Link>
    </nav>
  );
}
