import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { MonthlySummarySwitchRow } from '../MonthlySummarySwitchRow';

const api = vi.hoisted(() => ({ read: vi.fn(), set: vi.fn() }));
vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>();
  return { ...real, api: { ...real.api, monthlySummaryMail: api.read, setMonthlySummaryMail: api.set } };
});

function wrap(children: ReactNode, language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>{children}</HostedLanguageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  api.read.mockReset();
  api.set.mockReset();
});

/** MUT-535 (D7): You › Account's monthly summary switch. */
describe('MonthlySummarySwitchRow', () => {
  it('shows the server’s answer and turns the mail off', async () => {
    api.read.mockResolvedValue({ on: true });
    api.set.mockResolvedValue({ on: false });
    wrap(<MonthlySummarySwitchRow />);
    const toggle = await screen.findByRole('switch', { name: /Monthly summary email/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText("On the 1st: what came in and what's owed")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(api.set).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('is off for someone the default leaves out, and turns it on', async () => {
    api.read.mockResolvedValue({ on: false });
    api.set.mockResolvedValue({ on: true });
    wrap(<MonthlySummarySwitchRow />);
    const toggle = await screen.findByRole('switch', { name: /Monthly summary email/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(api.set).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('says so when the save failed, and keeps what the server has', async () => {
    api.read.mockResolvedValue({ on: true });
    api.set.mockRejectedValue(new Error('down'));
    wrap(<MonthlySummarySwitchRow />);
    const toggle = await screen.findByRole('switch', { name: /Monthly summary email/ });
    await userEvent.click(toggle);
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('shows nothing (no empty group) until the server answers, or when it can’t', async () => {
    api.read.mockRejectedValue(new Error('not found'));
    wrap(<MonthlySummarySwitchRow />);
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).toBeNull();
    expect(document.querySelector('.hp-you-group')).toBeNull();
  });

  it('reads in Arabic', async () => {
    api.read.mockResolvedValue({ on: true });
    wrap(<MonthlySummarySwitchRow />, 'ar');
    expect(await screen.findByRole('switch', { name: /الملخّص الشهري بالبريد/ })).toBeInTheDocument();
  });
});
