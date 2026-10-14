import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { act, renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { GO_HOSTED_DISMISSED_KEY, GO_HOSTED_SNOOZE_DAYS } from '../../../lib/goHosted';
import { HOSTED_OFFER_URL } from '../../../content/download-config';
import { useSampleSessionStore } from '../../../demo/sampleSessionStore';
import { GoHostedCard } from '../GoHostedCard';
import { useMalafatMomentStore } from '../../../lib/malafatMomentStore';

const LANGUAGE_KEY = 'mutaba3a-language';
const DAY = 24 * 60 * 60 * 1000;
const LOCALES = [
  ['en', en],
  ['ar', ar],
] as const;

const card = () => screen.queryByRole('group', { name: en.nav.goHosted.label });

beforeEach(() => {
  localStorage.clear();
  useSampleSessionStore.setState({ status: 'none' });
  useMalafatMomentStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GoHostedCard (MUT-187)', () => {
  describe.each(LOCALES)('in %s', (language, locale) => {
    it('shows one line of value, a Go hosted link to /hosted in a new tab, and a labelled dismiss', () => {
      chooseLanguage(language);
      renderWithProviders(<GoHostedCard />);

      const group = screen.getByRole('group', { name: locale.nav.goHosted.label });
      expect(group).toHaveTextContent(locale.nav.goHosted.text);
      const link = screen.getByRole('link', { name: `${locale.nav.goHosted.cta} ${locale.common.opensInNewTab}` });
      expect(link).toHaveAttribute('href', HOSTED_OFFER_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      const dismiss = screen.getByRole('button', { name: locale.nav.goHosted.dismiss });
      expect(dismiss).toHaveAttribute('title', locale.nav.goHosted.dismiss);
    });
  });

  it('reaches the link, then the dismiss button, with the keyboard; Enter dismisses', async () => {
    const user = userEvent.setup();
    const onDismissed = vi.fn();
    renderWithProviders(<GoHostedCard onDismissed={onDismissed} />);

    await user.tab();
    expect(screen.getByRole('link', { name: new RegExp(en.nav.goHosted.cta) })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: en.nav.goHosted.dismiss })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onDismissed).toHaveBeenCalledOnce();
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });

  it('remembers the dismissal, stays hidden within 30 days and comes back after', async () => {
    const t0 = Date.UTC(2026, 9, 14, 12);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(t0);
    const first = renderWithProviders(<GoHostedCard />);

    act(() => screen.getByRole('button', { name: en.nav.goHosted.dismiss }).click());
    expect(localStorage.getItem(GO_HOSTED_DISMISSED_KEY)).toBe(String(t0));
    act(() => vi.runAllTimers());
    expect(card()).not.toBeInTheDocument();
    first.unmount();

    vi.setSystemTime(t0 + (GO_HOSTED_SNOOZE_DAYS - 1) * DAY);
    const within = renderWithProviders(<GoHostedCard />);
    expect(card()).not.toBeInTheDocument();
    within.unmount();

    vi.setSystemTime(t0 + GO_HOSTED_SNOOZE_DAYS * DAY);
    renderWithProviders(<GoHostedCard />);
    expect(card()).toBeInTheDocument();
  });

  it('still hides for this tab when storage refuses the dismissal', async () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === GO_HOSTED_DISMISSED_KEY) throw new DOMException('blocked', 'SecurityError');
      realSetItem.call(this, key, value);
    });
    renderWithProviders(<GoHostedCard />);
    await userEvent.setup().click(screen.getByRole('button', { name: en.nav.goHosted.dismiss }));
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });

  it.each(['preparing', 'active'] as const)('stays out of the way while a visitor sample is %s', (status) => {
    useSampleSessionStore.setState({ status });
    renderWithProviders(<GoHostedCard />);
    expect(card()).not.toBeInTheDocument();
  });

  it('makes no network request when shown, followed or dismissed (ADR-024)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const user = userEvent.setup();
    renderWithProviders(<GoHostedCard />);

    const link = screen.getByRole('link', { name: new RegExp(en.nav.goHosted.cta) });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    await user.click(screen.getByRole('button', { name: en.nav.goHosted.dismiss }));
    await waitFor(() => expect(card()).not.toBeInTheDocument());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe('GoHostedCard and the Malafat suggestions (MUT-190)', () => {
  it('steps aside while a Malafat suggestion is on screen: one upsell at a time', () => {
    chooseLanguage('en');
    const release = useMalafatMomentStore.getState().claimSlot();
    const { rerender } = renderWithProviders(<GoHostedCard />);
    expect(card()).toBeNull();
    act(() => release());
    rerender(<GoHostedCard />);
    expect(card()).not.toBeNull();
  });
});
