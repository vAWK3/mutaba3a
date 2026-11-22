import { useId, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';

/**
 * One group of the Waiting lane (MUT-657): its own landmark named by its heading, the count (a number to the eye, a
 * sentence to a screen reader) and See all. The caller hides it at 0.
 */
export function HomeGroup({ title, count, countLabel, seeAll, children }: { title: string; count: number; countLabel: string; seeAll: { to: string; label: string; name: string }; children: ReactNode }) {
  const id = useId();
  return (
    <section className="hp-home-group" aria-labelledby={id}>
      <div className="hp-home-group-head">
        <h2 id={id}>{title}</h2>
        <span className="hp-home-count" aria-hidden="true">
          {count}
        </span>
        <span className="sr-only">{countLabel}</span>
        <Link to={seeAll.to} className="hp-home-see-all" aria-label={seeAll.name}>
          {seeAll.label}
        </Link>
      </div>
      {children}
    </section>
  );
}
