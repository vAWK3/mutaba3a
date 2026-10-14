import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { renderWithProviders, screen } from '../../../test/utils';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { HOSTED_OFFER_URL } from '../../../content/download-config';
import { HostedAccountEntry } from '../HostedAccountEntry';

const PORTAL = 'https://portal.test';
const LOCALES = [
  ['en', en],
  ['ar', ar],
] as const;

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('HostedAccountEntry (MUT-187)', () => {
  describe.each(LOCALES)('in %s', (language, locale) => {
    it('explains hosted in one sentence and links to /hosted and the portal, each in a new tab', () => {
      chooseLanguage(language);
      vi.stubGlobal('__PORTAL_URL__', PORTAL);
      renderWithProviders(<HostedAccountEntry />);

      const copy = locale.settings.profile.hosted;
      expect(screen.getByText(copy.title)).toBeInTheDocument();
      expect(screen.getByText(copy.description)).toBeInTheDocument();
      expect(screen.getByText(copy.signInPrompt)).toBeInTheDocument();

      const offer = screen.getByRole('link', { name: `${copy.cta} ${locale.common.opensInNewTab}` });
      expect(offer).toHaveAttribute('href', HOSTED_OFFER_URL);
      const signIn = screen.getByRole('link', { name: `${copy.signIn} ${locale.common.opensInNewTab}` });
      expect(signIn).toHaveAttribute('href', PORTAL);
      for (const link of [offer, signIn]) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });
  });

  it('leaves out the sign-in line when the build set no portal URL', () => {
    renderWithProviders(<HostedAccountEntry />);

    const copy = en.settings.profile.hosted;
    expect(screen.getByRole('link', { name: new RegExp(copy.cta) })).toBeInTheDocument();
    expect(screen.queryByText(copy.signInPrompt)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(copy.signIn) })).not.toBeInTheDocument();
  });
});
