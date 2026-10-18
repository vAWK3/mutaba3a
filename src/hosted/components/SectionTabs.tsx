import { Link } from '@tanstack/react-router';

/**
 * Sub-sections of one page as underlined links (MUT-268 17A): Expenses ·
 * Groups. Real links (each is a route, deep-linkable, back-button friendly),
 * so a `<nav>` with `aria-current="page"`, not a tablist; distinct from the
 * currency pill (`SegmentedTabs`), which filters within a page.
 */

export interface SectionTab {
  to: string;
  label: string;
  /** Lit only on exactly this path, not on the paths under it (the first tab's parent route). */
  exact?: boolean;
}

export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  return (
    <nav className="hp-section-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} activeOptions={{ exact: tab.exact ?? false, includeSearch: false }} activeProps={{ className: 'hp-section-tab-on', 'aria-current': 'page' }} className="hp-section-tab">
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
