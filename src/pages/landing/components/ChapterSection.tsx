import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useInView } from '../../../hooks/useInView';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';

/** How much of the visual must be on screen before it rises in. */
const REVEAL_THRESHOLD = 0.15;

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
  const figureRef = useRef<HTMLElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const seen = useInView(figureRef, { once: true, threshold: REVEAL_THRESHOLD });

  // The visual rises and fades in once (MUT-77, L10). It is only held back when
  // it starts below the fold, motion is allowed, and an observer exists to
  // bring it back; anything else would risk content stuck invisible. The
  // attribute is set on the DOM directly: React never renders it, and this
  // needs the element's position, which only exists after layout.
  useLayoutEffect(() => {
    const figure = figureRef.current;
    if (!figure || reducedMotion || typeof IntersectionObserver === 'undefined') return;
    if (figure.getBoundingClientRect().top < window.innerHeight) return;
    figure.dataset.reveal = 'pending';
    // Only on mount: a figure already shown never hides again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const figure = figureRef.current;
    if (seen && figure?.dataset.reveal === 'pending') figure.dataset.reveal = 'done';
  }, [seen]);

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
        <figure ref={figureRef} className="landing-chapter-visual">
          {visual}
        </figure>
      </div>
    </section>
  );
}
