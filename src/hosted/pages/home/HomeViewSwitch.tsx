import { useLanguage } from '../../../lib/i18n/core';

export type HomeView = 'todo' | 'in-out';
const VIEWS: readonly HomeView[] = ['todo', 'in-out'];
const LABEL: Record<HomeView, string> = { todo: 'hosted.home.view.todo', 'in-out': 'hosted.home.view.inOut' };

/** Home's two views (MUT-657): a segmented pair of toggle buttons (`aria-pressed`), in the header; full width on a phone. */
export function HomeViewSwitch({ view, onChange }: { view: HomeView; onChange: (view: HomeView) => void }) {
  const { t } = useLanguage();
  return (
    <div className="hp-home-switch" role="group" aria-label={t('hosted.home.view.label')}>
      {VIEWS.map((v) => (
        <button key={v} type="button" className="press" aria-pressed={view === v} onClick={() => onChange(v)}>
          {t(LABEL[v])}
        </button>
      ))}
    </div>
  );
}
