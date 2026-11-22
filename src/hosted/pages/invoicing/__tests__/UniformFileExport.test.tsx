import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HostedProfile } from '../../../api/client';
import { ToastProvider } from '../../../components/Toast';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { rangeOf, UniformFileExport } from '../UniformFileExport';

/** MUT-569: You › Invoicing's uniform-file card: a range, one download, and what came of it. */

const uniformFile = vi.fn();
const saveBlobAs = vi.fn();
vi.mock('../../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../api/client')>();
  return { ...real, api: { ...real.api, uniformFile: (...args: unknown[]) => uniformFile(...args) } };
});
vi.mock('../../../data/download', async (importOriginal) => ({ ...(await importOriginal<object>()), saveBlobAs: (...args: unknown[]) => saveBlobAs(...args) }));

const PROFILE = { id: 'p1', name: 'Barmajiyat', timezone: 'Asia/Jerusalem', owned: true } as HostedProfile;

function show(language: 'en' | 'ar' = 'en', profile = PROFILE) {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  render(
    <HostedLanguageProvider>
      <ToastProvider>
        <UniformFileExport profile={profile} />
      </ToastProvider>
    </HostedLanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  uniformFile.mockReset();
  saveBlobAs.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('rangeOf', () => {
  it('last year is the whole previous tax year; this year runs to today', () => {
    expect(rangeOf('lastYear', '2026-11-22')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(rangeOf('thisYear', '2026-11-22')).toEqual({ from: '2026-01-01', to: '2026-11-22' });
  });
});

describe('UniformFileExport', () => {
  it('downloads last year by default and says how many documents and records it holds', async () => {
    uniformFile.mockResolvedValue({ blob: new Blob(['zip']), filename: 'OPENFRMT-515151515-2025-01-01_2025-12-31.zip', documents: 312, records: 1204 });
    show();
    expect(screen.getByLabelText('From')).toHaveValue('2025-01-01');
    expect(screen.getByLabelText('From')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Download the file' }));
    expect(uniformFile).toHaveBeenCalledWith('p1', { from: '2025-01-01', to: '2025-12-31', lang: 'en' });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('OPENFRMT-515151515-2025-01-01_2025-12-31.zip');
    expect(status).toHaveTextContent('Documents: 312 · Records: 1204');
    expect(saveBlobAs).toHaveBeenCalledWith(expect.any(Blob), 'OPENFRMT-515151515-2025-01-01_2025-12-31.zip');
  });

  it('says so when no documents fall in the dates, and asks for the report in Arabic', async () => {
    uniformFile.mockResolvedValue({ blob: new Blob(['zip']), filename: 'f.zip', documents: 0, records: 2 });
    show('ar');
    await userEvent.click(screen.getByRole('button', { name: 'تنزيل الملف' }));
    expect(uniformFile).toHaveBeenCalledWith('p1', expect.objectContaining({ lang: 'ar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('لا مستندات في هذه التواريخ.');
  });

  it('other dates: a “to” before “from” is refused in place and nothing downloads', async () => {
    show();
    await userEvent.click(screen.getByRole('radio', { name: 'Other dates' }));
    const from = screen.getByLabelText('From');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-06-01');
    expect(screen.getByText('“To” comes before “From”.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download the file' })).toBeDisabled();
    expect(uniformFile).not.toHaveBeenCalled();
  });

  it('a failure is a toast with Try again', async () => {
    uniformFile.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ blob: new Blob(['zip']), filename: 'f.zip', documents: 1, records: 4 });
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Download the file' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(uniformFile).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Documents: 1');
  });

  it('tells a reader (an accountant) what the file is for this profile', () => {
    show('en', { ...PROFILE, owned: false });
    expect(screen.getByText(/every document this profile issued/)).toBeInTheDocument();
  });
});
