import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { BlockingDialog } from '../BlockingDialog';

/** MUT-346: a dialog that must be answered. Nothing behind it can be reached until it closes. */
function Page({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Behind
      </button>
      {open && (
        <BlockingDialog labelledBy="title">
          <h2 id="title">Answer me</h2>
          <button type="button">First</button>
          <button type="button" onClick={() => setOpen(false)}>
            Last
          </button>
        </BlockingDialog>
      )}
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('BlockingDialog (MUT-346)', () => {
  it('is a labelled modal dialog outside the app, and the app behind it is inert and hidden', () => {
    const { container } = render(<Page />);
    const dialog = screen.getByRole('dialog', { name: 'Answer me' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.contains(dialog)).toBe(false);
    expect(container).toHaveAttribute('inert');
    expect(container).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes focus on open and wraps Tab at both ends', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const dialog = screen.getByRole('dialog', { name: 'Answer me' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    screen.getByRole('button', { name: 'Last' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('swallows Escape before anything else hears it', async () => {
    const user = userEvent.setup();
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    render(<Page />);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Answer me' })).toBeInTheDocument();
  });

  it('on close gives the app back and returns focus to what had it before', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page initiallyOpen={false} />);
    const behind = screen.getByRole('button', { name: 'Behind' });
    await user.click(behind);
    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute('inert');
    expect(container).not.toHaveAttribute('aria-hidden');
    await vi.waitFor(() => expect(behind).toHaveFocus());
  });

  it('returns focus even when focus had already left the dialog (a pressed button disables itself and the browser drops focus)', async () => {
    const user = userEvent.setup();
    render(<Page initiallyOpen={false} />);
    const behind = screen.getByRole('button', { name: 'Behind' });
    await user.click(behind);
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    last.blur(); // what Chrome does when the focused button becomes disabled
    expect(document.activeElement).toBe(document.body);
    last.click();
    await vi.waitFor(() => expect(behind).toHaveFocus());
  });

  it('leaves an attribute the app already had in place when it closes', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page initiallyOpen={false} />);
    container.setAttribute('aria-hidden', 'false');
    await user.click(screen.getByRole('button', { name: 'Behind' }));
    expect(container).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(container).toHaveAttribute('aria-hidden', 'false');
  });

  it('stops the page behind from scrolling while open, and gives the scroll back after (review)', async () => {
    const user = userEvent.setup();
    const html = document.documentElement;
    html.style.overflow = 'auto';
    render(<Page initiallyOpen={false} />);
    await user.click(screen.getByRole('button', { name: 'Behind' }));
    expect(html.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(html.style.overflow).toBe('auto');
    html.style.overflow = '';
  });

  it('makes whatever joins <body> while it is open unreachable too, and gives it back after (review)', async () => {
    const user = userEvent.setup();
    render(<Page initiallyOpen={false} />);
    await user.click(screen.getByRole('button', { name: 'Behind' }));
    const late = document.createElement('div');
    document.body.appendChild(late);
    await vi.waitFor(() => expect(late).toHaveAttribute('inert'));
    expect(late).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(late).not.toHaveAttribute('inert');
    expect(late).not.toHaveAttribute('aria-hidden');
    late.remove();
  });

  it('with two open, only the newest is reachable, and either can close first (review)', () => {
    function Two({ first, second }: { first: boolean; second: boolean }) {
      return (
        <>
          {first && (
            <BlockingDialog labelledBy="one">
              <h2 id="one">One</h2>
            </BlockingDialog>
          )}
          {second && (
            <BlockingDialog labelledBy="two">
              <h2 id="two">Two</h2>
            </BlockingDialog>
          )}
        </>
      );
    }
    const { container, rerender } = render(<Two first second={false} />);
    const one = () => screen.getByRole('dialog', { name: 'One', hidden: true }).parentElement!;
    rerender(<Two first second />);
    const two = () => screen.getByRole('dialog', { name: 'Two' }).parentElement!;
    expect(one()).toHaveAttribute('inert');
    expect(two()).not.toHaveAttribute('inert');

    rerender(<Two first={false} second />); // the older one closes first
    expect(container).toHaveAttribute('inert');
    expect(two()).not.toHaveAttribute('inert');

    rerender(<Two first={false} second={false} />);
    expect(container).not.toHaveAttribute('inert');
    expect(container).not.toHaveAttribute('aria-hidden');
  });

  it('where the browser has no inert (iOS before 15.5, jsdom), focus that lands behind is brought back (review)', async () => {
    const user = userEvent.setup();
    render(<Page initiallyOpen={false} />);
    const behind = screen.getByRole('button', { name: 'Behind' });
    await user.click(behind);
    const dialog = screen.getByRole('dialog', { name: 'Answer me' });
    behind.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

