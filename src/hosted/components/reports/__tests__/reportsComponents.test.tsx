import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { CountUp } from '../HeroFigures';
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
