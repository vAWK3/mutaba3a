import { useEffect, useRef } from 'react';
import { useBusinessProfiles, useCreateBusinessProfile } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { useT, useLanguage } from '../../lib/i18n';
import './WelcomeModal.css';

export function WelcomeModal() {
  const t = useT();
  const { language } = useLanguage();
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: profiles, isLoading, isError } = useBusinessProfiles();
  const createMutation = useCreateBusinessProfile();
  const { openBusinessProfileDrawer, businessProfileDrawer } = useDrawerStore();

  // Don't show if:
  // - Still loading
  // - Error fetching profiles
  // - Profiles exist (even if just one)
  // - Data hasn't arrived yet (profiles is undefined)
  const hasNoProfiles = !isLoading && !isError && Array.isArray(profiles) && profiles.length === 0;

  // Don't show if BusinessProfileDrawer is open (user clicked "Set Up Now")
  const isDrawerOpen = businessProfileDrawer.isOpen;

  // Final condition - only show if truly no profiles and drawer not open
  const shouldShow = hasNoProfiles && !isDrawerOpen;

  // Focus modal when shown
  useEffect(() => {
    if (shouldShow && modalRef.current) {
      modalRef.current.focus();
    }
  }, [shouldShow]);

  // Handle skip - create default profile
  const handleSkip = async () => {
    const defaultName = language === 'ar' ? 'ملف تعريف افتراضي' : 'Default Profile';

    await createMutation.mutateAsync({
      name: defaultName,
      email: '',
      businessType: 'none',
      defaultCurrency: 'USD',
      defaultLanguage: language === 'ar' ? 'ar' : 'en',
      isDefault: true,
    });
  };

  // Handle set up now - open drawer
  const handleSetUpNow = () => {
    openBusinessProfileDrawer({ mode: 'create' });
  };

  // Don't render anything if conditions not met
  if (!shouldShow) {
    return null;
  }

  return (
    <>
      <div className="welcome-modal-overlay" />
      <div
        className="welcome-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="welcome-modal-content">
          <div className="welcome-modal-icon">
            <BusinessIcon />
          </div>

          <h2 id="welcome-modal-title" className="welcome-modal-title">
            {t('welcome.title')}
          </h2>

          <p className="welcome-modal-subtitle">
            {t('welcome.subtitle')}
          </p>

          <div className="welcome-modal-info">
            <h3 className="welcome-modal-info-title">
              {t('welcome.infoTitle')}
            </h3>
            <ul className="welcome-modal-list">
              <li>{t('welcome.bullet1')}</li>
              <li>{t('welcome.bullet2')}</li>
              <li>{t('welcome.bullet3')}</li>
            </ul>
            <p className="welcome-modal-info-note">
              {t('welcome.multipleProfiles')}
            </p>
          </div>

          <div className="welcome-modal-actions">
            <button
              className="btn btn-primary"
              onClick={handleSetUpNow}
            >
              {t('welcome.setUpNow')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleSkip}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t('common.saving') : t('welcome.skipForNow')}
            </button>
          </div>

          <p className="welcome-modal-skip-note">
            {t('welcome.skipNote')}
          </p>
        </div>
      </div>
    </>
  );
}

function BusinessIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z"
      />
    </svg>
  );
}
