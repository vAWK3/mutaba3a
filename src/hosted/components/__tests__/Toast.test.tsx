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

  it('re-renders an identical second info message so it is announced again (review #6)', async () => {
    render(
      <ToastProvider>
        <Trigger tone="info" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    const first = screen.getByText('Saved · ₪500.00 owed by Nour Studio');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    const second = screen.getByText('Saved · ₪500.00 owed by Nour Studio');
    expect(second).not.toBe(first);
  });
});

function ActionTrigger({ tone }: { tone: 'error' | 'info' }) {
  const show = useToast();
  return (
    <button type="button" onClick={() => show('Left out of Jordan trip', { tone, action: { label: 'Undo', onAction: () => show('Undone', { tone: 'info' }) } })}>
      act
    </button>
  );
}

function IconTrigger() {
  const show = useToast();
  return (
    <button
      type="button"
      onClick={() => show('Saved', { tone: 'info', icon: <span data-testid="save-feedback-icon" /> })}
    >
      go
    </button>
  );
}

describe('Toast icon override (MUT-338)', () => {
  it('renders the caller-supplied icon instead of the default InfoIcon when provided', async () => {
    render(
      <ToastProvider>
        <IconTrigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByTestId('toast-live').querySelector('[data-testid="save-feedback-icon"]')).not.toBeNull();
  });

  it('falls back to the default InfoIcon when no icon is supplied', async () => {
    render(
      <ToastProvider>
        <Trigger tone="info" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByTestId('toast-live').querySelector('[data-testid="save-feedback-icon"]')).toBeNull();
  });
});

describe('Toast actions (MUT-268)', () => {
  it.each(['info', 'error'] as const)('offers a pressable action in the %s tone and closes once it is used', async (tone) => {
    render(
      <ToastProvider>
        <ActionTrigger tone={tone} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'act' }));
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveClass('press');
    await userEvent.click(undo);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByTestId('toast-live')).toHaveTextContent('Undone');
  });
});
