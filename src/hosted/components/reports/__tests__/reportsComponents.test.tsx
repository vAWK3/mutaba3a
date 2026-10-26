import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { CountUp, HeroFigures } from '../HeroFigures';
import { ReportControls, type ReportControlsProps } from '../ReportControls';

/** MUT-175: the hero's count-up (DR21) and the control row (DR1, DR27, DS4, DT7). */

function inLanguage(language: 'en' | 'ar', ui: React.ReactNode) {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  return render(<HostedLanguageProvider>{ui}</HostedLanguageProvider>);
}

describe('CountUp', () => {
  it('shows the final value at once with reduced motion, and screen readers only ever read the final value', () => {
    inLanguage('en', <CountUp minor={123456} currency="ILS" reducedMotion />);
    const digits = document.querySelector('.hp-countup')!;
    expect(digits).toHaveAttribute('aria-hidden', 'true');
    expect(digits).toHaveTextContent('₪1,235');
    expect(document.querySelector('.sr-only')).toHaveTextContent('₪1,235');
  });

  it('counts up from zero when motion is allowed', () => {
    inLanguage('en', <CountUp minor={123456} currency="ILS" reducedMotion={false} />);
    expect(document.querySelector('.hp-countup')!.textContent).not.toBe('₪1,235');
    expect(document.querySelector('.sr-only')).toHaveTextContent('₪1,235');
  });
});

/**
 * MUT-448 (D6): the ≈ popover's rules, pinned before BreakdownButton is shared with the Glance. Each one was a MUT-175
 * review fix; none of them may change when the button starts taking its lines from the caller.
 */
describe('the ≈ breakdown popover', () => {
  const rates = { base: 'ILS', rateDate: '2026-10-23', fetchedAt: '2026-10-24T06:00:00Z', source: 'live', rates: [{ currency: 'ILS', rate: 1, derived: false }, { currency: 'USD', rate: 0.25, derived: false }] } as const;
  const hero = () =>
    inLanguage(
      'en',
      <>
        <HeroFigures received={new Map([['ILS', 100000], ['USD', 20000]])} spent={new Map([['ILS', 30000]])} unit={{ currency: 'ILS', rates: rates as never, singleCurrency: false }} caption="October so far" reducedMotion />
        <button type="button">elsewhere</button>
      </>,
    );
  const trigger = () => screen.getByRole('button', { name: /≈/ });
  const panel = () => screen.queryByRole('group', { name: 'Exact amounts' });

  it('opens on hover and closes when the pointer leaves', async () => {
    hero();
    await userEvent.hover(trigger());
    expect(panel()).not.toBeNull();
    await userEvent.unhover(trigger());
    expect(panel()).toBeNull();
  });

  it('stays open when the pointer leaves after a click opened it', async () => {
    hero();
    await userEvent.click(trigger());
    await userEvent.unhover(trigger());
    expect(panel()).not.toBeNull();
  });

  it('keeps a hover-opened panel open on the click that follows, and closes on a second click', async () => {
    hero();
    await userEvent.hover(trigger());
    await userEvent.click(trigger());
    expect(panel()).not.toBeNull();
    await userEvent.click(trigger());
    expect(panel()).toBeNull();
  });

  it('closes on Escape, returns focus to the figure, and does not reopen from that focus', async () => {
    hero();
    await userEvent.click(trigger());
    await userEvent.keyboard('{Escape}');
    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('does not open from a focus that is not keyboard focus', () => {
    hero();
    trigger().focus();
    expect(panel()).toBeNull();
  });

  it('closes when focus leaves the figure and its panel', async () => {
    hero();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(panel()).toBeNull();
  });
});

function controls(over: Partial<ReportControlsProps> = {}) {
  const props: ReportControlsProps = { period: 'month', onPeriod: vi.fn(), yearLockedUntil: null, canPrevious: true, canNext: false, onStep: vi.fn(), allProfiles: null, onAllProfiles: vi.fn(), ...over };
  return props;
}

describe('ReportControls', () => {
  it('is a radiogroup the arrows move through, following the reading direction', async () => {
    const props = controls();
    inLanguage('ar', <div dir="rtl"><ReportControls {...props} /></div>);
    const month = screen.getByRole('radio', { name: 'شهر' });
    expect(month).toHaveAttribute('aria-checked', 'true');
    month.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(props.onPeriod).toHaveBeenLastCalledWith('year');
  });

  it('keeps Year locked before stage 3: it says when, and a click does nothing', async () => {
    const props = controls({ yearLockedUntil: 'December' });
    inLanguage('en', <ReportControls {...props} />);
    const year = screen.getByRole('radio', { name: 'Year' });
    expect(year).toHaveAttribute('aria-disabled', 'true');
    expect(year).toHaveAttribute('aria-description', 'Unlocks in December');
    await userEvent.click(year);
    expect(props.onPeriod).not.toHaveBeenCalled();
  });

  it('labels the steps for the period, disables Next at the current period, and hides the switch with one profile', async () => {
    const props = controls();
    inLanguage('en', <ReportControls {...props} />);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(props.onStep).toHaveBeenCalledWith(-1);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the All-profiles switch with 2+ profiles and turns it on', async () => {
    const props = controls({ allProfiles: false });
    inLanguage('en', <ReportControls {...props} />);
    const toggle = screen.getByRole('switch', { name: 'All profiles' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(props.onAllProfiles).toHaveBeenCalledWith(true);
  });
});
