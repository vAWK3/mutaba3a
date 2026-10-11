import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { runIntegrityCheck } from '../../db/integrityCheck';
import { useT } from '../../lib/i18n';

const DISMISSED_KEY = 'banner-dismissed-orphans';

export function OrphanedRecordsBanner() {
  const t = useT();
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY) === 'true'
  );

  const { data: result } = useQuery({
    queryKey: ['integrity-check-banner'],
    queryFn: () => runIntegrityCheck(),
    staleTime: 60_000, // Re-check every 60 seconds at most
    enabled: !dismissed,
  });

  // Reset dismissed state if new orphaned records are detected
  useEffect(() => {
    if (result && result.orphanedRecords.length > 0 && dismissed) {
      const storedCount = localStorage.getItem('banner-orphan-count');
      if (storedCount && Number(storedCount) < result.orphanedRecords.length) {
        // New orphaned records found, re-show banner
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Query result is external state; re-showing the dismissed banner on change is intentional
        setDismissed(false);
        localStorage.removeItem(DISMISSED_KEY);
      }
    }
    if (result) {
      localStorage.setItem('banner-orphan-count', String(result.orphanedRecords.length));
    }
  }, [result, dismissed]);

  if (dismissed || !result || result.orphanedRecords.length === 0) {
    return null;
  }

  const count = result.orphanedRecords.length;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  return (
    <div className="orphaned-banner" role="alert">
      <span className="orphaned-banner-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          <line x1="8" y1="6" x2="8" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
        </svg>
      </span>
      <span className="orphaned-banner-text">
        {t(count === 1 ? 'integrity.orphanedRecordSingular' : 'integrity.orphanedRecordPlural', { count })}
      </span>
      <a href="/settings" className="orphaned-banner-action">
        {t('integrity.reviewNow')}
      </a>
      <button className="orphaned-banner-dismiss" onClick={handleDismiss} aria-label={t('integrity.dismiss')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
