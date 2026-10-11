import type { ReactNode } from 'react';

interface ChapterSectionProps {
  /** Stable name for the chapter; also the `data-part` the page structure test reads. */
  part: string;
  title: string;
  body: string;
  visual: ReactNode;
  /** Put the visual on the reading-start side instead of the end. */
  flip?: boolean;
}

/** One idea per chapter: a big line, a short paragraph, and one visual. */
export function ChapterSection({ part, title, body, visual, flip = false }: ChapterSectionProps) {
  const headingId = `${part}-title`;

  return (
    <section
      data-part={part}
      aria-labelledby={headingId}
      className={`landing-section landing-chapter${flip ? ' landing-chapter--flip' : ''}`}
    >
      <div className="landing-container landing-chapter-layout">
        <div className="landing-chapter-copy">
          <h2 id={headingId} className="landing-chapter-title">
            {title}
          </h2>
          <p className="landing-chapter-body">{body}</p>
        </div>
        <figure className="landing-chapter-visual">{visual}</figure>
      </div>
    </section>
  );
}
