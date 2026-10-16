import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import en from '../../../lib/i18n/translations/en';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '1.2.3';
});

const { useCheckForUpdatesMock } = vi.hoisted(() => ({
  useCheckForUpdatesMock: vi.fn(),
}));

vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: useCheckForUpdatesMock,
}));

import { AboutSection } from '../AboutSection';

function renderSection() {
  return render(
    <LanguageProvider>
      <AboutSection />
    </LanguageProvider>,
  );
}

describe('AboutSection', () => {
  it('merges About, Updates and Desktop App under one heading, no subheadings', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: false, error: null });
    const { container } = renderSection();

    expect(screen.getByRole('heading', { level: 2, name: en.settings.about.title })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(container.querySelectorAll('.settings-section-title')).toHaveLength(1);
  });

  it('shows the app name and description once, not duplicated with the update status version line', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: false, error: null });
    renderSection();

    expect(screen.getByText(en.settings.about.name)).toBeInTheDocument();
    expect(screen.getByText(en.settings.about.description)).toBeInTheDocument();
    // Version appears exactly once, in the update-status row below — not also in this blurb.
    expect(screen.getAllByText('1.2.3')).toHaveLength(1);
  });

  it('links to the support pages', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: false, error: null });
    renderSection();

    expect(screen.getByRole('link', { name: en.settings.about.buyMeCoffee })).toHaveAttribute(
      'href',
      'https://buymeacoffee.com/elmokhtbr',
    );
    expect(screen.getByRole('link', { name: en.settings.about.kofi })).toHaveAttribute(
      'href',
      'https://ko-fi.com/elmokhtbr',
    );
  });

  it('shows the up-to-date row when no update is available', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: false, error: null });
    renderSection();

    expect(screen.getByText(en.settings.updates.upToDate)).toBeInTheDocument();
  });

  it('shows checking state and the current version while the update check is in flight', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: true, error: null });
    renderSection();

    expect(screen.getByText(en.settings.updates.checking)).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
  });

  it('shows the failure message and the current version when the check fails', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: false, error: 'network error' });
    renderSection();

    expect(screen.getByText(en.settings.updates.checkFailed)).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
  });

  it('shows an update card with a download link when an update is available', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: '9.9.9', hasUpdate: true, isLoading: false, error: null });
    renderSection();

    expect(screen.getByText(en.settings.updates.updateAvailable)).toBeInTheDocument();
    expect(screen.getByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.settings.updates.updateNow })).toHaveAttribute('href', '/download');
  });

  it('shows desktop download links and the all-versions link', () => {
    useCheckForUpdatesMock.mockReturnValue({ latestVersion: null, hasUpdate: false, isLoading: false, error: null });
    renderSection();

    expect(screen.getByRole('link', { name: en.settings.desktopApp.downloadMac })).toHaveAttribute(
      'href',
      '/download/mac',
    );
    expect(screen.getByRole('link', { name: en.settings.desktopApp.downloadWindows })).toHaveAttribute(
      'href',
      '/download/windows',
    );
    expect(screen.getByRole('link', { name: en.settings.desktopApp.downloadBtn })).toHaveAttribute(
      'href',
      '/download',
    );
  });
});
