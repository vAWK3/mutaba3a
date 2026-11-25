import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { ApiError } from '../../../api/client';
import { MailOffPage } from '../MailOffPage';

const hoisted = vi.hoisted(() => ({ hash: 'tok.sig', search: {} as Record<string, unknown>, navigate: vi.fn(), mailPreference: vi.fn(), offerMailPreference: vi.fn() }));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...real, useLocation: () => ({ hash: hoisted.hash, search: hoisted.search, pathname: '/mail-off' }), useNavigate: () => hoisted.navigate };
});
vi.mock('../../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../api/client')>();
  return { ...real, api: { ...real.api, mailPreference: hoisted.mailPreference, offerMailPreference: hoisted.offerMailPreference } };
});
vi.mock('../../../components/Brand', () => ({ LanguageSwitch: () => null, Wordmark: () => null }));

function show(language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  render(
    <HostedLanguageProvider>
      <MailOffPage />
    </HostedLanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  hoisted.hash = 'tok.sig';
  hoisted.search = {};
  hoisted.navigate.mockReset();
  hoisted.mailPreference.mockReset();
  hoisted.offerMailPreference.mockReset();
});

/** MUT-535 (D8): the monthly summary's turn-it-off page. */
describe('MailOffPage', () => {
  it('changes nothing on opening: it asks first (a link scanner never presses), and drops the token from the URL', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Turn off the monthly summary?' })).toBeInTheDocument();
    expect(hoisted.mailPreference).not.toHaveBeenCalled();
    expect(hoisted.navigate).toHaveBeenCalledWith({ to: '/mail-off', hash: '', replace: true });
  });

  it('turns it off with the token, then offers to turn it back on', async () => {
    hoisted.mailPreference.mockResolvedValueOnce({ on: false }).mockResolvedValueOnce({ on: true });
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Turn it off' }));
    expect(hoisted.mailPreference).toHaveBeenCalledWith('tok.sig', false);
    expect(await screen.findByRole('heading', { name: 'The monthly summary is off.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn it back on' }));
    expect(hoisted.mailPreference).toHaveBeenLastCalledWith('tok.sig', true);
    expect(await screen.findByRole('heading', { name: 'The monthly summary is on.' })).toBeInTheDocument();
  });

  it('points at You › Account when the link no longer works', async () => {
    hoisted.mailPreference.mockRejectedValue(new ApiError(404, 'NOT_FOUND' as never, 'This link no longer works', null, null, null));
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Turn it off' }));
    expect(await screen.findByText('This link no longer works. You can turn it off in You › Account.')).toBeInTheDocument();
  });

  it('says so when the server can’t be reached, and lets the person try again', async () => {
    hoisted.mailPreference.mockRejectedValue(new TypeError('network'));
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Turn it off' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn it off' })).toBeEnabled();
  });

  it('with no token at all, says the link doesn’t work', () => {
    hoisted.hash = '';
    show();
    expect(screen.getByText('This link no longer works. You can turn it off in You › Account.')).toBeInTheDocument();
  });

  it('reads in Arabic', () => {
    show('ar');
    expect(screen.getByRole('heading', { name: 'إيقاف الملخّص الشهري؟' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أوقفه' })).toBeInTheDocument();
  });
});

/** ADR-278: the come-back offer's unsubscribe lands on the same page with `?mail=offers`. */
describe('MailOffPage for offers', () => {
  it('asks first, then turns promotional mail off and offers to turn it back on, leaving the monthly summary alone', async () => {
    hoisted.search = { mail: 'offers' };
    hoisted.offerMailPreference.mockResolvedValueOnce({ on: false }).mockResolvedValueOnce({ on: true });
    show();
    expect(screen.getByRole('heading', { name: 'Stop offers from MTB3A?' })).toBeInTheDocument();
    expect(hoisted.offerMailPreference).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(hoisted.offerMailPreference).toHaveBeenCalledWith('tok.sig', false);
    expect(hoisted.mailPreference).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: "You won't get offers from MTB3A." })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send me offers again' }));
    expect(hoisted.offerMailPreference).toHaveBeenLastCalledWith('tok.sig', true);
    expect(await screen.findByRole('heading', { name: 'Offers from MTB3A are on.' })).toBeInTheDocument();
  });

  it('says it in Arabic', () => {
    hoisted.search = { mail: 'offers' };
    show('ar');
    expect(screen.getByRole('heading', { name: 'إيقاف عروض متابعة؟' })).toBeInTheDocument();
  });
});
