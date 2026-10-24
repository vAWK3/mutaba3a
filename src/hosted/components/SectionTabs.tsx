import { Link } from '@tanstack/react-router';

/**
 * Sub-sections of one page as links (MUT-268 17A): Expenses · Groups, underlined. Real links (each is a route,
 * deep-linkable, back-button friendly), so a `<nav>` with `aria-current="page"`, not a tablist; distinct from the
 * currency pill (`SegmentedTabs`), which filters within a page. MUT-425: the You page's Profiles · Account · App
 * are the same links drawn as a segmented pill (`variant="segmented"`), each carrying the page's `?from=`.
 */

export interface SectionTab {
  to: string;
  label: string;
  /** Lit only on exactly this path, not on the paths under it (the first tab's parent route). */
  exact?: boolean;
  /** Search the link carries (MUT-425: the You page's `from`); none by default. */
  search?: Record<string, string>;
}

export function SectionTabs({ label, tabs, variant = 'underline' }: { label: string; tabs: SectionTab[]; variant?: 'underline' | 'segmented' }) {
  return (
    <nav className={variant === 'segmented' ? 'hp-section-tabs hp-section-tabs--segmented' : 'hp-section-tabs'} aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          search={tab.search ?? {}}
          activeOptions={{ exact: tab.exact ?? false, includeSearch: false }}
          activeProps={{ className: 'hp-section-tab-on', 'aria-current': 'page' }}
          className="hp-section-tab"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
