import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../Toast';

function Trigger({ tone }: { tone?: 'error' | 'info' }) {
  const show = useToast();
  return (
    <button type="button" onClick={() => (tone ? show('Saved · ₪500.00 owed by Nour Studio', { tone }) : show('Could not sign out'))}>
      go
    </button>
  );
}

describe('Toast (MUT-133)', () => {
  it('renders the polite live region before any message, so a later status is announced (A2), without a status role while empty', () => {
    render(
      <ToastProvider>
        <Trigger tone="info" />
      </ToastProvider>,
    );
    const region = screen.getByTestId('toast-live');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('fills the existing status region for an info message, with no alert', async () => {
    render(
      <ToastProvider>
        <Trigger tone="info" />
      </ToastProvider>,
    );
    const region = screen.getByTestId('toast-live');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByTestId('toast-live')).toBe(region);
    expect(region).toHaveTextContent('Saved · ₪500.00 owed by Nour Studio');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the error tone, as an alert, for callers that pass only a message', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not sign out');
    expect(screen.getByTestId('toast-live')).toBeEmptyDOMElement();
  });
});
