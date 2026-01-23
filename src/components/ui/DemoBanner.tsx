/**
 * Demo Mode Banner
 *
 * Displays a persistent banner at the top of the app when demo mode is active.
 * Provides controls for time freezing and resetting demo mode.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../lib/i18n';
import {
  useDemoStore,
  resetDemoMode,
  freezeTime,
  unfreezeTime,
  DEFAULT_FROZEN_TIME,
} from '../../demo';
import './DemoBanner.css';

export function DemoBanner() {
  const t = useT();
  const queryClient = useQueryClient();

  const { isActive, frozenTime } = useDemoStore();
  const [isResetting, setIsResetting] = useState(false);

  if (!isActive) {
    return null;
  }

  const handleFreezeTime = () => {
    if (frozenTime) {
      unfreezeTime();
    } else {
      freezeTime(DEFAULT_FROZEN_TIME);
    }
  };

  const handleReset = async () => {
    if (isResetting) return;

    const confirmed = window.confirm(t('demo.banner.resetConfirm'));
    if (!confirmed) return;

    setIsResetting(true);
    try {
      await resetDemoMode();
      queryClient.invalidateQueries();
      // Reload to ensure clean state
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset demo mode:', error);
      setIsResetting(false);
    }
  };

  const frozenDateDisplay = frozenTime
    ? new Date(frozenTime).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';

  return (
    <div className="demo-banner" role="banner">
      <div className="demo-banner-content">
        <div className="demo-banner-badge">
          <BeakerIcon />
          <span>{t('demo.banner.label')}</span>
        </div>

        {frozenTime && (
          <div className="demo-banner-frozen">
            <ClockIcon />
            <span>
              {t('demo.banner.frozenTo', { date: frozenDateDisplay })}
            </span>
          </div>
        )}
      </div>

      <div className="demo-banner-actions">
        <button
          className="demo-banner-btn"
          onClick={handleFreezeTime}
          title={frozenTime ? t('demo.banner.unfreezeTime') : t('demo.banner.freezeTime')}
        >
          {frozenTime ? <PlayIcon /> : <PauseIcon />}
          <span>{frozenTime ? t('demo.banner.unfreeze') : t('demo.banner.freeze')}</span>
        </button>

        <button
          className="demo-banner-btn demo-banner-btn-danger"
          onClick={handleReset}
          disabled={isResetting}
          title={t('demo.banner.resetDemo')}
        >
          <TrashIcon />
          <span>{isResetting ? t('demo.banner.resetting') : t('demo.banner.reset')}</span>
        </button>
      </div>
    </div>
  );
}

function BeakerIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
