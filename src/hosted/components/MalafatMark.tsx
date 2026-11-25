/**
 * MUT-596: Malafat's mark (two diamonds on a beam over a pivot), vendored from malafat.app's public brand files and
 * served from this origin (`public/brand/`), never hotlinked. Decorative: the label beside it names Malafat. The
 * light and dark files swap in CSS (`.hp-malafat-mark-*` in hosted.css), so it follows the theme without its context.
 */
export function MalafatMark({ size = 20 }: { size?: number }) {
  return (
    <span className="hp-malafat-mark" aria-hidden="true">
      <img className="hp-malafat-mark-light" src="/brand/malafat-mark.svg" alt="" width={size} height={size} />
      <img className="hp-malafat-mark-dark" src="/brand/malafat-mark-on-dark.svg" alt="" width={size} height={size} />
    </span>
  );
}
