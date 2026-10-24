import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Bar } from '../../../data/expenseGroups';
import { DayBars } from '../DayBars';

/** MUT-268 20A: a labelled group of bar buttons with one tab stop; arrows follow the reading direction. */

const bar = (from: string, minor: number, position: Bar['position'] = 'in'): Bar => ({ key: `${position}:${from}`, from, to: from, position, minor, total: (minor / 1000).toFixed(3), count: minor > 0 ? 1 : 0, max: 120000 });
const bars = [bar('2026-09-12', 120000, 'before'), bar('2026-10-03', 48000), bar('2026-10-04', 0), bar('2026-10-05', 96000)];

function renderBars(dir: 'ltr' | 'rtl', onJump = vi.fn()) {
  render(
    <div dir={dir}>
      <DayBars
        bars={bars}
        label="JOD per day"
        describe={(b) => `${b.from} ${b.total}`}
        axisLabel={(b, i) => (i === 0 ? b.from : null)}
        gapLabel={(p) => (p === 'before' ? 'before the trip' : 'upcoming')}
        hasOther={(b) => b.from === '2026-10-04'}
        onJump={onJump}
        reducedMotion
      />
    </div>,
  );
  return onJump;
}

describe('DayBars', () => {
  it('is one labelled group of buttons with a single tab stop on the first day of the dates', () => {
    renderBars('ltr');
    const group = screen.getByRole('group', { name: 'JOD per day' });
    const buttons = screen.getAllByRole('button');
    expect(group).toContainElement(buttons[0]!);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(screen.getByText(/before the trip/)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: '2026-10-04 0.000' })).toHaveClass('hp-daybar-other', 'hp-daybar-zero');
  });

  it('moves with the arrows left to right, Home and End, and jumps on Enter', async () => {
    const onJump = renderBars('ltr');
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName('2026-10-03 48.000');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('2026-10-04 0.000');
    await user.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName('2026-10-05 96.000');
    await user.keyboard('{Home}');
    expect(document.activeElement).toHaveAccessibleName('2026-09-12 120.000');
    await user.keyboard('{Enter}');
    expect(onJump).toHaveBeenCalledWith(bars[0]);
  });

  it('mirrors the arrows right to left', async () => {
    renderBars('rtl');
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAccessibleName('2026-10-04 0.000');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('2026-09-12 120.000');
  });
});

/**
 * MUT-175 D5: characterization tests pinning today's single-series chart before
 * DayBars learns a second series, so the expense-group chart provably doesn't drift.
 */
describe('DayBars — single-series contract (MUT-175 D5)', () => {
  const pinned = [...bars, bar('2026-10-20', 24000, 'after')];
  const halved = pinned.map((b) => ({ ...b, minor: b.minor / 2 }));
  const fills = () => [...document.querySelectorAll<HTMLElement>('.hp-daybar-fill')];

  function renderPinned(props: Partial<Parameters<typeof DayBars>[0]> = {}) {
    return render(
      <div dir="ltr">
        <DayBars
          bars={pinned}
          label="JOD per day"
          describe={(b) => `${b.from} ${b.total}`}
          axisLabel={(_b, i) => (i === 1 ? '3' : null)}
          gapLabel={(p) => (p === 'before' ? 'before the trip' : 'upcoming')}
          hasOther={(b) => b.from === '2026-10-04'}
          onJump={vi.fn()}
          reducedMotion
          {...props}
        />
      </div>,
    );
  }

  it('renders one button per bar whose name and tooltip are the describe text', () => {
    renderPinned();
    const buttons = screen.getAllByRole('button');
    const texts = ['2026-09-12 120.000', '2026-10-03 48.000', '2026-10-04 0.000', '2026-10-05 96.000', '2026-10-20 24.000'];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(texts);
    expect(buttons.map((b) => b.querySelector('.hp-daybar-tip')?.textContent)).toEqual(texts);
    expect(buttons.map((b) => [...b.classList].find((c) => /^hp-daybar-(before|in|after)$/.test(c)))).toEqual(['hp-daybar-before', 'hp-daybar-in', 'hp-daybar-in', 'hp-daybar-in', 'hp-daybar-after']);
  });

  it('marks only the other-currency day with the dot, and zero days as zero', () => {
    renderPinned();
    const other = document.querySelectorAll('.hp-daybar-other');
    expect(other).toHaveLength(1);
    expect(other[0]).toHaveAccessibleName('2026-10-04 0.000');
    expect(document.querySelectorAll('.hp-daybar-zero')).toHaveLength(1);
  });

  it('draws one gap label at each change of position, and the axis label only where asked', () => {
    renderPinned();
    expect([...document.querySelectorAll('.hp-daybars-gap')].map((g) => g.textContent)).toEqual(['⋯ before the trip', '⋯ upcoming']);
    expect([...document.querySelectorAll('.hp-daybar-x')].map((a) => a.textContent)).toEqual(['3']);
  });

  it('marks the selected bar and puts the tab stop on it; edge bars flip their tooltip inward', () => {
    renderPinned({ selected: 'in:2026-10-05' });
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.classList.contains('hp-daybar-sel'))).toEqual([false, false, false, true, false]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
    expect(buttons[0]).toHaveClass('hp-tip-start');
    expect(buttons[4]).toHaveClass('hp-tip-end');
  });

  it('paints each fill at its share of the tallest bar, and jumps (no spring) under reduced motion', () => {
    const { rerender } = renderPinned();
    expect(fills().map((f) => f.style.transform)).toEqual(['scaleY(1)', 'scaleY(0.4)', 'scaleY(0)', 'scaleY(0.8)', 'scaleY(0.2)']);
    rerender(
      <div dir="ltr">
        <DayBars bars={halved} label="JOD per day" describe={(b) => b.from} axisLabel={() => null} gapLabel={() => ''} hasOther={() => false} onJump={vi.fn()} reducedMotion />
      </div>,
    );
    expect(fills().map((f) => f.style.transform)).toEqual(['scaleY(0.5)', 'scaleY(0.2)', 'scaleY(0)', 'scaleY(0.4)', 'scaleY(0.1)']);
  });

  it('draws no second fill and marks no future bar for a single-series caller', () => {
    renderPinned();
    expect(document.querySelectorAll('.hp-daybar-fill-2')).toHaveLength(0);
    expect(document.querySelector('.hp-daybars-pair')).toBeNull();
    expect(document.querySelectorAll('.hp-daybar-future')).toHaveLength(0);
  });

  it('springs rather than jumps when motion is allowed', () => {
    const { rerender } = renderPinned({ reducedMotion: false });
    rerender(
      <div dir="ltr">
        <DayBars bars={halved} label="JOD per day" describe={(b) => b.from} axisLabel={() => null} gapLabel={() => ''} hasOther={() => false} onJump={vi.fn()} reducedMotion={false} />
      </div>,
    );
    expect(fills()[0]!.style.transform).toBe('scaleY(1)');
  });
});

/** MUT-175 (D1, DR13, DR22): Reports' received-and-spent chart, opt-in props only. */
describe('DayBars — a second series and future days (MUT-175)', () => {
  const days = [bar('2026-10-01', 120000), bar('2026-10-02', 0), bar('2026-10-03', 30000), bar('2026-10-04', 0)];
  const spent: Record<string, number> = { '2026-10-01': 60000, '2026-10-02': 0, '2026-10-03': 0, '2026-10-04': 0 };

  function renderPair() {
    return render(
      <div dir="ltr">
        <DayBars
          bars={days}
          label="Received and spent per day"
          describe={(b) => `${b.from} in ${b.minor} out ${spent[b.from]}`}
          axisLabel={() => null}
          gapLabel={() => ''}
          hasOther={() => false}
          second={(b) => spent[b.from]!}
          future={(b) => b.from > '2026-10-03'}
          onJump={vi.fn()}
          reducedMotion
        />
      </div>,
    );
  }

  it('draws both fills at their share of the tallest bar, zero only when both are zero', () => {
    renderPair();
    expect(document.querySelector('.hp-daybars')).toHaveClass('hp-daybars-pair');
    const second = [...document.querySelectorAll<HTMLElement>('.hp-daybar-fill-2')].map((f) => f.style.transform);
    expect(second).toEqual(['scaleY(0.5)', 'scaleY(0)', 'scaleY(0)']);
    expect(screen.getByRole('button', { name: '2026-10-02 in 0 out 0' })).toHaveClass('hp-daybar-zero');
    expect(screen.getByRole('button', { name: '2026-10-01 in 120000 out 60000' })).not.toHaveClass('hp-daybar-zero');
  });

  it('draws future days faint, out of the tab order and the accessibility tree, and the arrows skip them', async () => {
    renderPair();
    const future = document.querySelector('.hp-daybar-future');
    expect(future).toHaveAttribute('aria-hidden', 'true');
    expect(future?.tagName).toBe('SPAN');
    expect(future?.querySelector('.hp-daybar-tip')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName('2026-10-03 in 30000 out 0');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('2026-10-03 in 30000 out 0');
  });
});
