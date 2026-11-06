import type { ReactNode } from 'react';
import { LanguageSwitch, Wordmark } from './Brand';

/**
 * MUT-562 (layout B): the public pages a stranger opens (a share link, an accountant invite). A lavender context panel
 * says what this is; the action panel holds the one thing to do. Side by side on a desktop, stacked on a phone
 * (context first). No shell: nobody need be signed in.
 *
 * TODO(MUT-561): the context panel's scene (`shared-books`, `link-closed`, `share-ended`) comes with MUT-561's Scene
 * renderer; until it merges the panel is words only.
 */
export function TwoPanelLayout({ context, children, wide = false }: { context: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`hp-two-panel${wide ? ' hp-two-panel-wide' : ''}`}>
      <header className="hp-two-panel-top">
        <Wordmark markSize={32} />
        <LanguageSwitch />
      </header>
      <div className="hp-two-panel-body">
        <aside className="hp-two-panel-context">{context}</aside>
        <main className="hp-two-panel-action">{children}</main>
      </div>
    </div>
  );
}
