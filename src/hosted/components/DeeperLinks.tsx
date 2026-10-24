import { useT } from '../../lib/i18n/core';
import type { Destination } from '../shell/destinations';
import { RowNavLink } from './YouRows';

/**
 * "One level in" (MUT-424 E4, eng D1): a quiet list of links at the bottom of a destination page to the pages that
 * sit under it (Owed → Receivables, Paid → Conversions, Clients → Documents). The rows are drawn like the You page's
 * rows, carry no counts or figures (the ticket adds none), and sit outside the page's QueryView, so the way in still
 * shows while the page's own list is loading, empty or failed.
 */

export interface DeeperLink {
  to: string;
  /** `hosted.deeper.<key>.label` and `.sub`. */
  key: 'receivables' | 'conversions' | 'documents';
}

export function DeeperLinks({ destination, links }: { destination: Destination; links: DeeperLink[] }) {
  const t = useT();
  return (
    <nav className="hp-deeper" aria-label={t('hosted.deeper.label', { destination: t(`hosted.destinations.${destination}`) })}>
      <div className="hp-you-box">
        {links.map((link) => (
          <RowNavLink key={link.key} to={link.to} label={t(`hosted.deeper.${link.key}.label`)} sub={t(`hosted.deeper.${link.key}.sub`)} />
        ))}
      </div>
    </nav>
  );
}
