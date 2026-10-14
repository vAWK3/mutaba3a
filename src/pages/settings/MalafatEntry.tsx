import { useEffect, useRef } from 'react';
import { useLanguage, useT } from '../../lib/i18n';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { useMalafatSuggestions, useDismissMalafatMoment, useSetMalafatSuggestionsOn } from '../../lib/useMalafatSuggestions';
import { showBusinessAddedNote } from '../../lib/malafatSuggestions';
import { useMalafatMomentStore } from '../../lib/malafatMomentStore';
import { malafatUrl } from '../../content/malafatLinks';
import { Switch } from '../../components/ui/Switch';
import { MalafatSuggestionCard } from '../../components/malafat/MalafatSuggestionCard';
import './MalafatEntry.css';

const SWITCH_LABEL_ID = 'malafat-suggestions-label';

/**
 * Settings › Businesses' "Mutaba3a + Malafat" row (MUT-190, S1): one line for
 * law firms and accounting offices, one link to Malafat, and the "Show Malafat
 * suggestions" switch. The row stays when suggestions are off. Right after a
 * second business is added (C1) its line becomes a note about that business,
 * with the same single link, so Settings never shows two Malafat links.
 * Web build only; SettingsPage gates it.
 */
export function MalafatEntry() {
  const t = useT();
  const { language } = useLanguage();
  const suggestions = useMalafatSuggestions();
  const { data: profiles = [] } = useBusinessProfiles();
  const businessAdded = useMalafatMomentStore((s) => s.businessAdded);
  const clearBusinessAdded = useMalafatMomentStore((s) => s.clearBusinessAdded);
  const retire = useDismissMalafatMoment();
  const setOn = useSetMalafatSuggestionsOn();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const focusLinkNext = useRef(false);

  const live = profiles.filter((profile) => !profile.archivedAt).length;
  const note = suggestions !== null && showBusinessAddedNote({ suggestions, businessAdded, businessCount: live });

  // After the note goes, focus lands on the row's own link, which takes its place
  useEffect(() => {
    if (focusLinkNext.current && linkRef.current) {
      focusLinkNext.current = false;
      linkRef.current.focus();
    }
  });

  const link = (content: 'settings' | 'business-profile') =>
    malafatUrl({ locale: language, medium: 'web-local', content, contact: true });

  return (
    <div className="malafat-entry">
      <div className="settings-label">{t('settings.profile.malafat.title')}</div>
      {note ? (
        <MalafatSuggestionCard
          variant="note"
          label={t('settings.profile.malafat.noteLabel')}
          text={t('settings.profile.malafat.businessAdded')}
          href={link('business-profile')}
          ctaLabel={t('settings.profile.malafat.cta')}
          dismissLabel={t('settings.profile.malafat.dismiss')}
          onRetire={() => {
            clearBusinessAdded();
            retire.mutate('business-profile');
          }}
          onGone={() => {
            focusLinkNext.current = true;
          }}
        />
      ) : (
        <>
          <p className="malafat-entry-text">{t('settings.profile.malafat.text')}</p>
          <div>
            <a ref={linkRef} href={link('settings')} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary">
              {t('settings.profile.malafat.cta')}{' '}
              <span className="sr-only">{t('common.opensInNewTab')}</span>
            </a>
          </div>
        </>
      )}
      <div className="settings-row malafat-entry-switch">
        <div>
          <div className="settings-label" id={SWITCH_LABEL_ID}>
            {t('settings.profile.malafat.switchLabel')}
          </div>
          <div className="settings-description">{t('settings.profile.malafat.switchDescription')}</div>
        </div>
        <Switch
          checked={suggestions?.on ?? true}
          onChange={(on) => setOn.mutate(on)}
          labelledBy={SWITCH_LABEL_ID}
          disabled={suggestions === null || setOn.isPending}
        />
      </div>
    </div>
  );
}
