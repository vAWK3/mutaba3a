import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../../test/utils';
import { useMalafatMomentStore } from '../../../lib/malafatMomentStore';
import { MalafatSuggestionCard } from '../MalafatSuggestionCard';

const props = {
  label: 'A suggestion for law firms and accounting offices',
  text: 'Lots of clients to keep track of?',
  href: 'https://malafat.app/en/contact?topic=mutaba3a',
  ctaLabel: 'See Malafat',
  dismissLabel: "Don't show this again",
};

beforeEach(() => {
  localStorage.setItem('mutaba3a-language', 'en');
  useMalafatMomentStore.getState().reset();
});

/** The inline Malafat suggestion (MUT-190): one line, one link out, one permanent dismiss; no modal, no toast. */
describe('MalafatSuggestionCard', () => {
  it('is a labelled group with the line, a new-tab link and a named dismiss', () => {
    renderWithProviders(<MalafatSuggestionCard {...props} onGone={vi.fn()} onRetire={vi.fn()} />);
    const group = screen.getByRole('group', { name: props.label });
    expect(group).toHaveTextContent(props.text);
    const link = screen.getByRole('link', { name: 'See Malafat (opens in a new tab)' });
    expect(link).toHaveAttribute('href', props.href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: props.dismissLabel })).toBeInTheDocument();
  });

  it('holds the upsell slot while shown, so the Go hosted card steps aside', () => {
    const { unmount } = renderWithProviders(<MalafatSuggestionCard {...props} onGone={vi.fn()} onRetire={vi.fn()} />);
    expect(useMalafatMomentStore.getState().suggestionsShown).toBe(1);
    unmount();
    expect(useMalafatMomentStore.getState().suggestionsShown).toBe(0);
  });

  it('disappears at once on dismiss, retires the moment, and hands focus back', async () => {
    const onRetire = vi.fn();
    const onGone = vi.fn();
    renderWithProviders(<MalafatSuggestionCard {...props} onGone={onGone} onRetire={onRetire} />);
    await userEvent.click(screen.getByRole('button', { name: props.dismissLabel }));
    expect(screen.queryByRole('group', { name: props.label })).toBeNull();
    expect(onRetire).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(useMalafatMomentStore.getState().suggestionsShown).toBe(0);
  });

  it('counts a click on the link as seen: the moment retires too', async () => {
    const onRetire = vi.fn();
    renderWithProviders(<MalafatSuggestionCard {...props} onGone={vi.fn()} onRetire={onRetire} />);
    const link = screen.getByRole('link', { name: 'See Malafat (opens in a new tab)' });
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onRetire).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: props.label })).toBeNull();
  });
});
