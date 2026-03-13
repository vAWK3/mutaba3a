import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../../lib/i18n';
import { UpdateBanner } from '../ui/UpdateBanner';

// Mock the platform detection
vi.mock('../../lib/platform', () => ({
  isTauri: vi.fn(() => true),
  isWeb: vi.fn(() => false),
}));

// Mock the Tauri updater hook
const mockUseTauriUpdater = vi.fn();
vi.mock('../../hooks/useTauriUpdater', () => ({
  useTauriUpdater: () => mockUseTauriUpdater(),
  isTauri: vi.fn(() => true),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

describe('UpdateBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    // Default mock state - no update available
    mockUseTauriUpdater.mockReturnValue({
      status: 'idle',
      currentVersion: '0.0.48',
      availableVersion: null,
      downloadProgress: 0,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should not render when no update is available', () => {
    const { container } = render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(container.querySelector('.update-banner')).toBeNull();
  });

  it('should not render when status is checking', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'checking',
      currentVersion: '0.0.48',
      availableVersion: null,
      downloadProgress: 0,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    const { container } = render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(container.querySelector('.update-banner')).toBeNull();
  });

  it('should not render when status is up-to-date', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'up-to-date',
      currentVersion: '0.0.49',
      availableVersion: null,
      downloadProgress: 0,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    const { container } = render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(container.querySelector('.update-banner')).toBeNull();
  });

  it('should render when update is available', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'idle',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 0,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(screen.getByText(/0\.0\.49/)).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('should call downloadAndInstall when download button is clicked', async () => {
    const downloadAndInstall = vi.fn();
    mockUseTauriUpdater.mockReturnValue({
      status: 'idle',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 0,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall,
      applyUpdate: vi.fn(),
    });

    const user = userEvent.setup();

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    const downloadButton = screen.getByText('Download');
    await user.click(downloadButton);

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it('should show download progress when downloading', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'downloading',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 45,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(screen.getByText(/45%/)).toBeInTheDocument();
  });

  it('should show restart button when update is ready', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'ready',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 100,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(screen.getByText('Restart to Update')).toBeInTheDocument();
  });

  it('should call applyUpdate when restart button is clicked', async () => {
    const applyUpdate = vi.fn();
    mockUseTauriUpdater.mockReturnValue({
      status: 'ready',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 100,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate,
    });

    const user = userEvent.setup();

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    const restartButton = screen.getByText('Restart to Update');
    await user.click(restartButton);

    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('should show error message when update fails', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'error',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 0,
      error: 'Network error',
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(screen.getByText('Update failed')).toBeInTheDocument();
  });

  it('should dismiss banner and remember dismissal for this version', async () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'idle',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 0,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    const user = userEvent.setup();

    const { rerender } = render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    // Banner should be visible
    expect(screen.getByText(/0\.0\.49/)).toBeInTheDocument();

    // Click dismiss
    const dismissButton = screen.getByLabelText('Later');
    await user.click(dismissButton);

    // Banner should be hidden
    await waitFor(() => {
      expect(screen.queryByText(/0\.0\.49/)).not.toBeInTheDocument();
    });

    // Verify localStorage was updated
    expect(localStorage.getItem('update-banner-dismissed-version')).toBe('0.0.49');

    // Re-render - should still be dismissed
    rerender(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(screen.queryByText(/0\.0\.49/)).not.toBeInTheDocument();
  });

  it('should not show dismiss button while downloading', () => {
    mockUseTauriUpdater.mockReturnValue({
      status: 'downloading',
      currentVersion: '0.0.48',
      availableVersion: '0.0.49',
      downloadProgress: 50,
      error: null,
      checkNow: vi.fn(),
      downloadAndInstall: vi.fn(),
      applyUpdate: vi.fn(),
    });

    render(
      <TestWrapper>
        <UpdateBanner />
      </TestWrapper>
    );

    expect(screen.queryByLabelText('Later')).not.toBeInTheDocument();
  });
});
