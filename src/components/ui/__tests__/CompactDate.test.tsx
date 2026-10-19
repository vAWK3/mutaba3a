import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CompactDate } from '../CompactDate';

/**
 * MUT-250: a compact table's date column took its width from its widest date, and
 * Thmanyah's digits are proportional, so Income at 375px was 718px wide on 11/11 and
 * 736px on 08/08. The compact date is set in the figure face (`.num`: Plex Mono,
 * tabular digits), so every date is one width.
 */
describe('CompactDate (MUT-250)', () => {
  it('shows dd/mm/yyyy in the tabular figure face', () => {
    const { container } = render(<CompactDate iso="2026-08-08T10:00:00" />);
    const date = container.querySelector('span');
    expect(date).toHaveTextContent('08/08/2026');
    expect(date).toHaveClass('num');
  });
});
