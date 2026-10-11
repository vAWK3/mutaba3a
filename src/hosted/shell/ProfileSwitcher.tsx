import { useLocation, useNavigate } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useMe } from '../session/me';
import { usePopover } from './usePopover';

/**
 * The profile switcher (hosted-portal.md §7.2): each hosted profile with its
 * "Hosted" chip and where its figures come from, and a footer that says local
 * profiles stay on the device. Switching keeps the section, never the record:
 * a client id from one firm means nothing in another.
 */

const SECTION_SEGMENT = 3; // '' / 'p' / ':id' / section

export function sourceKey(profile: HostedProfile): string {
  return profile.writerOfRecord === 'MALAFAT' ? 'hosted.shell.switcher.sourceMalafat' : 'hosted.shell.switcher.sourceExpensesOnly';
}

export function ProfileSwitcher({ active }: { active: HostedProfile | null }) {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const popover = usePopover();

  function choose(profile: HostedProfile) {
    popover.close();
    const section = location.pathname.split('/')[SECTION_SEGMENT];
    void navigate({ to: section ? `/p/${profile.id}/${section}` : `/p/${profile.id}` });
  }

  return (
    <div className="hp-switcher">
      <button
        ref={popover.buttonRef}
        type="button"
        className="hp-switcher-button"
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-label={active ? `${t('hosted.shell.switcher.label')}: ${active.name}` : t('hosted.shell.switcher.label')}
        onClick={popover.toggle}
      >
        <span className="hp-switcher-name">{active ? active.name : t('hosted.shell.switcher.label')}</span>
        {active && <span className="hp-chip">{t('hosted.shell.switcher.hosted')}</span>}
        <span className="hp-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {popover.open && (
        <div ref={popover.panelRef} className="hp-popover hp-switcher-panel" role="menu" aria-label={t('hosted.shell.switcher.label')}>
          {me.profiles.map((profile) => {
            const current = profile.id === active?.id;
            return (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={`hp-option ${current ? 'hp-option-on' : ''}`}
                onClick={() => choose(profile)}
              >
                <span className="hp-check" aria-hidden="true">
                  {current ? '✓' : ''}
                </span>
                <span className="hp-option-text">
                  <span className="hp-option-line">
                    <span>{profile.name}</span>
                    <span className="hp-chip">{t('hosted.shell.switcher.hosted')}</span>
                  </span>
                  <span className="hp-option-sub">{t(sourceKey(profile))}</span>
                </span>
              </button>
            );
          })}
          <p className="hp-popover-foot">{t('hosted.shell.switcher.localFooter')}</p>
        </div>
      )}
    </div>
  );
}
