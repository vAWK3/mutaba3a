import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { HostedProfile } from '../../api/client';
import { firmBannerKey } from '../../data/firmBanner';

/**
 * MUT-300 (DR5): one dismissible "Firm features are on" banner on the
 * Overview, no checklist. Dismissing it keeps it gone for this person and
 * profile in this browser; storage that throws still shows it, and dismiss
 * still works for the page.
 */

const STUDIO = 'd1111111-1111-4111-8111-111111111111';
const USER_ID = me().user.id;
const studio = profile({ id: STUDIO, name: 'Khatib Law', writerOfRecord: null, owned: true, type: 'BUSINESS', firm: true, role: 'OWNER' });
const TEXT = "Firm features are on for Khatib Law. New tools show up here as they're released.";

function portal(profiles: HostedProfile[] = [studio]) {
  stubApi({ 'GET /v1/me': () => ok(me(profiles)), ...emptyProfileRoutes() });
  return renderPortal(`/p/${profiles[0].id}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.removeItem(PORTAL_LANGUAGE_KEY);
  localStorage.removeItem(firmBannerKey(USER_ID, STUDIO));
});

describe('FirmOnBanner (MUT-300, DR5)', () => {
  it('shows once firm features are on, naming the profile', async () => {
    portal();
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
  });

  it('stays hidden while firm features are off', async () => {
    portal([{ ...studio, firm: false, role: null }]);
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('keeps a dismissal for this person and profile, across a reload', async () => {
    const { user, unmount } = portal();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(localStorage.getItem(firmBannerKey(USER_ID, STUDIO))).toBe('dismissed');
    unmount();
    vi.unstubAllGlobals();
    portal();
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('still shows, and still dismisses for the page, when storage throws', async () => {
    // Only the banner's key throws: the rest of the portal keeps its own storage handling.
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    const blocked = (key: string) => key.startsWith('mutaba3a-firm-banner:');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (blocked(key)) throw new Error('blocked');
      return getItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (blocked(key)) throw new Error('blocked');
      setItem.call(this, key, value);
    });
    const { user } = portal();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(TEXT)).toBeNull());
  });

  it('reads in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal();
    expect(await screen.findByText('ميزات المكتب مفعّلة لملف Khatib Law. تظهر الأدوات الجديدة هنا عند إصدارها.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeInTheDocument();
  });
});
