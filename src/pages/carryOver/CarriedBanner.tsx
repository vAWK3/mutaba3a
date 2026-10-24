import { getLocale, useLanguage } from '../../lib/i18n/core';

/**
 * Over every page of the free app once its records were carried (MUT-291 D1):
 * where they went, when, and that changes made here won't follow. Nothing
 * stops an edit here (TD-227); the banner makes it plain, and Carry over again
 * sends the latest records.
 */
export function CarriedBanner({ portalOrigin, carriedOverAt, onCarryAgain }: { portalOrigin: string; carriedOverAt: string; onCarryAgain: () => void }) {
  const { t, language } = useLanguage();
  return (
    <div className="carry-over-banner" role="note" data-testid="carry-over-banner">
      <span>{t('carryOver.banner', { address: new URL(portalOrigin).host, date: new Intl.DateTimeFormat(getLocale(language), { dateStyle: 'medium' }).format(new Date(carriedOverAt)) })}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onCarryAgain}>
        {t('carryOver.carryAgain')}
      </button>
    </div>
  );
}
