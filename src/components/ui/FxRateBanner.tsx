/**
 * FxRateBanner Component
 * Floating banner showing current USD/ILS exchange rate.
 * Features: draggable, minimizable, persistent position.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFxRate } from '../../hooks/useFxRate';
import { useT } from '../../lib/i18n';
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

export function FxRateBanner() {
  const t = useT();
  const { rate, source, isLoading, lastUpdated, refetch } = useFxRate('USD', 'ILS');

  const [state, setState] = useState<BannerState>(loadState);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const bannerRef = useRef<HTMLDivElement>(null);

  // Persist state changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('fx-banner-drag-handle')) {
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
    refetch();
  }, [refetch]);

  // Format rate for display
  const formattedRate = rate !== null ? rate.toFixed(4) : '—';

  // Get relative time for last updated
  const lastUpdatedText = lastUpdated ? formatRelativeDate(lastUpdated, t) : '';

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
      <button
        className="fx-banner-minimized"
        onClick={toggleMinimize}
        title={t('fx.showBanner')}
        style={positionStyle}
      >
        <span className="fx-banner-mini-icon">$↔₪</span>
        {source !== 'none' && rate !== null && (
          <span className="fx-banner-mini-rate">{rate.toFixed(2)}</span>
        )}
      </button>
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
        <div className="fx-banner-rate">
          <span className="fx-banner-formula">$1 = {formattedRate} ₪</span>
          <span className={cn('fx-banner-source', `source-${source}`)}>
            {isLoading ? (
              <span className="fx-loading">...</span>
            ) : (
              <>
                <span className="fx-source-dot" />
                {t(`fx.${source}`)}
              </>
            )}
          </span>
        </div>
        {lastUpdatedText && source !== 'none' && (
          <div className="fx-banner-updated">{lastUpdatedText}</div>
        )}
      </div>

      <div className="fx-banner-actions">
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
