/**
 * FxRateBanner Component
 * Floating banner showing current USD/ILS exchange rate.
 * Features: draggable, minimizable, persistent position.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFxRate } from '../../hooks/useFxRate';
import { useT } from '../../lib/i18n';
import { useTheme, type ThemeMode } from '../../lib/theme';
import { formatRelativeDate, cn } from '../../lib/utils';
import './FxRateBanner.css';

const STORAGE_KEY = 'mutaba3a_fx_banner_state';

interface BannerState {
  isMinimized: boolean;
  position: { x: number; y: number };
}

const DEFAULT_STATE: BannerState = {
  isMinimized: false,
  position: { x: 0, y: 0 }, // 0,0 means default CSS position
};

function loadState(): BannerState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_STATE;
}

function saveState(state: BannerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

// Helper to cycle through theme modes
function getNextTheme(current: ThemeMode): ThemeMode {
  const cycle: ThemeMode[] = ['light', 'dark', 'system'];
  const currentIndex = cycle.indexOf(current);
  return cycle[(currentIndex + 1) % cycle.length];
}

export function FxRateBanner() {
  const t = useT();
  const { rate: usdRate, source: usdSource, isLoading: usdLoading, lastUpdated: usdLastUpdated, refetch: refetchUsd } = useFxRate('USD', 'ILS');
  const { rate: eurRate, source: eurSource, isLoading: eurLoading, refetch: refetchEur } = useFxRate('EUR', 'ILS');
  const { theme, resolvedTheme, setTheme } = useTheme();

  // Combined loading state
  const isLoading = usdLoading || eurLoading;
  const lastUpdated = usdLastUpdated;

  const [state, setState] = useState<BannerState>(loadState);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const bannerRef = useRef<HTMLDivElement>(null);

  // Persist state changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Handle drag start - allow dragging from anywhere except buttons/actions
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Don't drag if clicking on buttons or action area
    if (
      target.closest('.fx-banner-actions') ||
      target.closest('button') ||
      target.tagName === 'BUTTON'
    ) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);

    const banner = bannerRef.current;
    if (banner) {
      const rect = banner.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const banner = bannerRef.current;
      if (!banner) return;

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Constrain to viewport
      const maxX = window.innerWidth - banner.offsetWidth;
      const maxY = window.innerHeight - banner.offsetHeight;

      setState((prev) => ({
        ...prev,
        position: {
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        },
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const toggleMinimize = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isMinimized: !prev.isMinimized,
    }));
  }, []);

  const handleRefresh = useCallback(() => {
    refetchUsd();
    refetchEur();
  }, [refetchUsd, refetchEur]);

  const handleToggleTheme = useCallback(() => {
    setTheme(getNextTheme(theme));
  }, [theme, setTheme]);

  // Get theme label for tooltip
  const themeLabel = t(`settings.theme.${theme}`);

  // Format rates for display
  const formattedUsdRate = usdRate !== null ? usdRate.toFixed(4) : '—';
  const formattedEurRate = eurRate !== null ? eurRate.toFixed(4) : '—';

  // Get relative time for last updated
  const lastUpdatedText = lastUpdated ? formatRelativeDate(lastUpdated, t) : '';

  // Determine overall source (most conservative)
  const overallSource = usdSource === 'none' || eurSource === 'none' ? 'none' :
                        usdSource === 'cached' || eurSource === 'cached' ? 'cached' : 'live';

  // Position style
  const positionStyle: React.CSSProperties =
    state.position.x !== 0 || state.position.y !== 0
      ? {
          left: state.position.x,
          top: state.position.y,
          right: 'auto',
          bottom: 'auto',
        }
      : {};

  // Minimized view
  if (state.isMinimized) {
    return (
      <div
        ref={bannerRef}
        className={cn('fx-banner-minimized', isDragging && 'dragging')}
        style={positionStyle}
        onMouseDown={handleMouseDown}
      >
        <div className="fx-banner-drag-handle fx-banner-drag-handle-mini" title={t('fx.drag')}>
          <svg width="6" height="10" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="6" cy="2" r="1.5" />
            <circle cx="2" cy="7" r="1.5" />
            <circle cx="6" cy="7" r="1.5" />
            <circle cx="2" cy="12" r="1.5" />
            <circle cx="6" cy="12" r="1.5" />
          </svg>
        </div>
        <button
          className="fx-banner-mini-content"
          onClick={toggleMinimize}
          title={t('fx.showBanner')}
        >
          <span className="fx-banner-mini-icon">$↔₪</span>
          {usdSource !== 'none' && usdRate !== null && (
            <span className="fx-banner-mini-rate">{usdRate.toFixed(2)}</span>
          )}
        </button>
        <button
          className="fx-banner-mini-theme"
          onClick={handleToggleTheme}
          title={themeLabel}
          aria-label={themeLabel}
        >
          {resolvedTheme === 'dark' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="5" />
              <path strokeLinecap="round" d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          )}
        </button>
      </div>
    );
  }

  // Expanded view
  return (
    <div
      ref={bannerRef}
      className={cn('fx-rate-banner', isDragging && 'dragging')}
      style={positionStyle}
      onMouseDown={handleMouseDown}
      role="banner"
      aria-label={t('fx.bannerTitle')}
    >
      <div className="fx-banner-drag-handle" title={t('fx.drag')}>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="6" cy="2" r="1.5" />
          <circle cx="2" cy="7" r="1.5" />
          <circle cx="6" cy="7" r="1.5" />
          <circle cx="2" cy="12" r="1.5" />
          <circle cx="6" cy="12" r="1.5" />
        </svg>
      </div>

      <div className="fx-banner-content">
        <div className="fx-banner-rates">
          <div className="fx-banner-rate">
            <span className="fx-banner-formula">$1 = {formattedUsdRate} ₪</span>
            <span className={cn('fx-banner-source', `source-${usdSource}`)}>
              {usdLoading ? (
                <span className="fx-loading">...</span>
              ) : (
                <>
                  <span className="fx-source-dot" />
                  {t(`fx.${usdSource}`)}
                </>
              )}
            </span>
          </div>
          <div className="fx-banner-rate">
            <span className="fx-banner-formula">€1 = {formattedEurRate} ₪</span>
            <span className={cn('fx-banner-source', `source-${eurSource}`)}>
              {eurLoading ? (
                <span className="fx-loading">...</span>
              ) : (
                <>
                  <span className="fx-source-dot" />
                  {t(`fx.${eurSource}`)}
                </>
              )}
            </span>
          </div>
        </div>
        {lastUpdatedText && overallSource !== 'none' && (
          <div className="fx-banner-updated">{lastUpdatedText}</div>
        )}
      </div>

      <div className="fx-banner-actions">
        <button
          className="fx-banner-btn"
          onClick={handleToggleTheme}
          title={themeLabel}
          aria-label={themeLabel}
        >
          {resolvedTheme === 'dark' ? (
            // Moon icon for dark mode
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          ) : (
            // Sun icon for light mode
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="5" />
              <path
                strokeLinecap="round"
                d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
              />
            </svg>
          )}
        </button>
        <button
          className="fx-banner-btn"
          onClick={handleRefresh}
          disabled={isLoading}
          title={t('fx.refresh')}
          aria-label={t('fx.refresh')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={isLoading ? 'spinning' : ''}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <button
          className="fx-banner-btn"
          onClick={toggleMinimize}
          title={t('fx.minimize')}
          aria-label={t('fx.minimize')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
