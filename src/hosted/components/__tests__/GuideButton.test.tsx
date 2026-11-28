import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuideButton } from '../GuideButton';

/**
 * MUT-674: the button a feature's own screen carries. It only asks the shell to open the guide; the URL key, the page's
 * kept state and the drawer are the shell's (GuideDrawer.test.tsx drives them through the real portal).
 */

const { openGuide } = vi.hoisted(() => ({ openGuide: vi.fn() }));
vi.mock('../../shell/AccountDrawers', () => ({ useAccountDrawers: () => ({ openGuide }) }));
vi.mock('../../../lib/i18n/core', () => ({ useT: () => (key: string) => key }));

describe('GuideButton (MUT-674)', () => {
  it('is a button with the guide icon that opens its guide', async () => {
    openGuide.mockClear();
    render(<GuideButton guide="tax-authority" label="How to connect" />);
    const button = screen.getByRole('button', { name: 'How to connect' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.className).toMatch(/hp-link-button/);
    expect(button.className).toMatch(/\bpress\b/);
    await userEvent.setup().click(button);
    expect(openGuide).toHaveBeenCalledWith('tax-authority');
  });

  it('is named "Guide" when it has no label of its own', () => {
    render(<GuideButton guide="tax-authority" />);
    expect(screen.getByRole('button', { name: 'hosted.guide.open' })).toBeInTheDocument();
  });
});
