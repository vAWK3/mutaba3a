import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../lib/i18n';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { useSampleSessionStore } from '../../demo/sampleSessionStore';
import { APP_VERSION } from '../../lib/appVersion';
import {
  RELEASE_NOTES,
  markWhatsNewSeen,
  pendingNotes,
  useWhatsNewStore,
  type ReleaseNotes,
} from '../../lib/whatsNew';
import './DeleteAllDataModal.css';
import './WhatsNewModal.css';

/**
 * "What's new" (MUT-24): the notes for every version since the one this browser
 * last dismissed, newest first, in the chosen language. "Got it", Escape or the
 * backdrop dismiss it for the running version. A centred modal, not a drawer:
 * it is a one-time notice, not work on a record.
 */
export function WhatsNewModal({ current = APP_VERSION }: { current?: string }) {
  const { t, language } = useLanguage();
  const entries = useWhatsNewStore((s) => s.entries);
  const closeWhatsNew = useWhatsNewStore((s) => s.closeWhatsNew);
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const isOpen = entries !== null;

  const dismiss = useCallback(() => {
    markWhatsNewSeen(current);
    closeWhatsNew();
  }, [current, closeWhatsNew]);

  useEffect(() => {
    if (!isOpen) return;
    modalRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, dismiss]);

  if (!entries) return null;

  return createPortal(
    <>
      <div className="modal-overlay" onClick={dismiss} />
      <div className="modal whats-new" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={modalRef} tabIndex={-1}>
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{t('whatsNew.title')}</h2>
        </div>
        <div className="modal-body">
          {entries.map((entry) => (
            <section key={entry.version} className="whats-new-version">
              <h3 className="whats-new-version-title">
                {t('whatsNew.version')} <bdi dir="ltr">{entry.version}</bdi>
              </h3>
              <ul className="whats-new-list">
                {entry[language].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={dismiss}>
            {t('whatsNew.dismiss')}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * Opens "What's new" once per start when there are notes this browser has not
 * dismissed. It waits while the welcome flow owns the screen: no business yet
 * (WelcomeModal), or the landing page's sample being set up.
 */
export function WhatsNewController({
  notes = RELEASE_NOTES,
  current = APP_VERSION,
}: {
  notes?: ReleaseNotes;
  current?: string;
}) {
  const { data: profiles } = useBusinessProfiles();
  const isPreparingSample = useSampleSessionStore((s) => s.status === 'preparing');
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);
  const checked = useRef(false);
  const ready = Array.isArray(profiles) && profiles.length > 0 && !isPreparingSample;

  useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    const pending = pendingNotes(notes, current);
    if (pending.length) openWhatsNew(pending);
  }, [ready, notes, current, openWhatsNew]);

  return null;
}
