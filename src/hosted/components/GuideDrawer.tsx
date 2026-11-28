import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { isGuideId, loadGuide, type Guide, type LocalizedText } from '../../content/guides';
import { trackGuide } from '../analytics/portalAnalytics';
import { SUPPORT_EMAIL } from '../terms';
import { Drawer } from './Drawer';
import { QueryView } from './QueryView';
import { SCENE_NAMES, Scene, type SceneName } from './Scene';

/**
 * MUT-674: a guide in a drawer over the page. One content file per guide (`src/content/guides/<id>.json`, copy in both
 * languages), opened by the URL key `?guide=<id>` on every page, signed in or out. Closing it (✕, Escape, the overlay,
 * Done) returns to the page as it was. Layout from the mockup the founder picked: the hero, the lead, every step in one
 * scrolling list, the note, the official source, then help. Done is the footer's one button and the only thing that
 * counts a guide finished; the cross, Escape and the overlay count nothing.
 *
 * The first screen rises once (docs/design/motion/2026-11-27-guides/website-entrance: 14px, 50ms apart, text readable
 * from frame 1); reduced motion shows the still. The step-change slide is the phone's.
 */

/** A guide's scene name is checked against the drawn art in CI (guides.test.ts); `Scene` shows its placeholder otherwise. */
const asScene = (name: string): SceneName => (SCENE_NAMES.includes(name as SceneName) ? (name as SceneName) : 'empty-state');

export function GuideDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const known = isGuideId(id);
  // A typo, an old link, a phone-only guide: nothing to show, so the key goes (replacing its history entry).
  useEffect(() => {
    if (!known) onClose();
  }, [known, onClose]);
  if (!known) return null;
  return <KnownGuideDrawer id={id} onClose={onClose} />;
}

function KnownGuideDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  // A chunk that cannot load (offline, stale after a deploy) is the unreachable state with Retry, never a silent close.
  const query = useQuery({ queryKey: ['guide', id], queryFn: () => loadGuide(id), staleTime: Infinity, retry: false });
  const guide = query.data;
  const line = (text: LocalizedText) => text[language] ?? text.en;

  // One opening, once: a re-render and StrictMode's second effect run are not openings. Counted when the guide shows.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!guide || counted.current === guide.id) return;
    counted.current = guide.id;
    trackGuide('guide_opened', guide.id);
  }, [guide]);

  const finish = () => {
    trackGuide('guide_finished', id);
    onClose();
  };

  return (
    <Drawer
      title={guide ? line(guide.title) : t('hosted.guide.open')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        guide && (
          <div className="drawer-footer-right">
            <Button variant="primary" onClick={finish}>
              {t('hosted.guide.done')}
            </Button>
          </div>
        )
      }
    >
      <QueryView queries={[query]} data={guide}>
        {(loaded) => <GuideBody guide={loaded} line={line} />}
      </QueryView>
    </Drawer>
  );
}

function GuideBody({ guide, line }: { guide: Guide; line: (text: LocalizedText) => string }) {
  const t = useT();
  return (
    <div className="hp-guide" data-testid="guide-body">
      <Scene name={asScene(guide.hero)} size={120} className="hp-guide-hero hp-guide-rise hp-guide-rise-1" />
      <p className="hp-guide-lead hp-guide-rise hp-guide-rise-2">{line(guide.lead)}</p>
      <ol className="hp-guide-steps">
        {guide.steps.map((step, i) => (
          <li key={i} className={i === 0 ? 'hp-guide-step hp-guide-rise hp-guide-rise-3' : 'hp-guide-step'}>
            <Scene name={asScene(step.scene)} size={120} />
            <span>{line(step.text)}</span>
          </li>
        ))}
      </ol>
      {guide.note && (
        <p className="hp-guide-note" role="note">
          {line(guide.note)}
        </p>
      )}
      {guide.ifStuck && <p className="hp-guide-stuck">{line(guide.ifStuck)}</p>}
      <div className="hp-guide-links">
        {guide.source && (
          <a className="hp-guide-link press" href={guide.source.url} target="_blank" rel="noopener noreferrer">
            {line(guide.source.label)}
            <span className="sr-only"> {t('hosted.guide.opensInNewTab')}</span>
          </a>
        )}
        <a className="hp-guide-link press" href={`mailto:${SUPPORT_EMAIL}`}>
          {t('hosted.guide.needHelp')}
        </a>
      </div>
    </div>
  );
}
