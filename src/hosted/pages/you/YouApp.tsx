import { useLanguage } from '../../../lib/i18n/core';
import type { HostedProfile } from '../../api/client';
import { AppDownloadRows } from '../../components/AppDownloadRows';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { MalafatRows } from '../../components/MalafatPortal';
import { UsageSwitchRow } from '../../components/UsageSwitchRow';
import { RowGroup, RowLink } from '../../components/YouRows';
import { useIsLocalMode } from '../../session/mode';
import { termsHref } from '../../terms';

/**
 * You › App (MUT-425; was the account menu's lower half): Language and the anonymous-usage switch (MUT-155), then
 * Malafat on an eligible profile (MUT-191), the terms (MUT-324) and the phone apps (MUT-261), which stay last.
 * Signed out: Language and the terms only. No telemetry signed out (brief §10), and no store links: the phone app
 * can't see this device's records (MUT-285 brief §11, MUT-186 9A). The product's wordmark heads the part: the floating
 * shell has none (MUT-426 D3), so this, sign-in and the tab title are where MTB3A / متابعة is named.
 */

/** The old sidebar's lockup size: the Arabic name beside it at 16px (design D3, MUT-402). */
const APP_MARK_SIZE = 32;
export function YouApp({ profile }: { profile: HostedProfile | null }) {
  const { t, language } = useLanguage();
  const local = useIsLocalMode();
  const termsLink = termsHref(language);
  return (
    <>
      <Wordmark className="hp-you-wordmark" markSize={APP_MARK_SIZE} />
      <RowGroup label={t('hosted.you.groups.preferences')}>
        <div className="hp-you-row hp-you-row--static">
          <span className="hp-you-row-text">
            <span className="hp-you-row-label">{t('hosted.shell.language')}</span>
          </span>
          <LanguageSwitch />
        </div>
        {!local && <UsageSwitchRow />}
      </RowGroup>
      {/* Signed out with no terms configured there is nothing more to show, so no empty box */}
      {(!local || termsLink) && (
        <RowGroup label={t('hosted.you.groups.more')}>
          {!local && <MalafatRows profile={profile} />}
          {termsLink && <RowLink label={t('hosted.terms.link')} href={termsLink} />}
          {!local && <AppDownloadRows />}
        </RowGroup>
      )}
    </>
  );
}
