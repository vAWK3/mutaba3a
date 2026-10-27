import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { InPlaceConfirm, useConfirmStep } from '../InPlaceConfirm';

const LABELS = { message: 'Delete “Taxi” ($12.00)? This can’t be undone.', cancelLabel: 'Cancel', confirmLabel: 'Delete' };

describe('InPlaceConfirm (DESIGN.md › Destructive confirm, MUT-115 DR7)', () => {
  it('is a group named by its sentence, with Cancel focused and the action in the danger style', () => {
    render(<InPlaceConfirm {...LABELS} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const group = screen.getByRole('group', { name: LABELS.message });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger');
  });

  it('calls onConfirm from the action and onCancel from Cancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<InPlaceConfirm {...LABELS} onCancel={onCancel} onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels it and never reaches a document listener (the drawer stays open)', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const drawerEscape = vi.fn();
    function DocumentListener() {
      useEffect(() => {
        const handler = (event: KeyboardEvent) => {
          if (event.key === 'Escape') drawerEscape();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      }, []);
      return null;
    }
    render(
      <>
        <DocumentListener />
        <InPlaceConfirm {...LABELS} onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(drawerEscape).not.toHaveBeenCalled();
  });

  it('while busy the action is disabled and says so, and Cancel stays usable', () => {
    render(<InPlaceConfirm {...LABELS} busy onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});

describe('InPlaceConfirm options (MUT-461, TD-267: the operator console builds on it)', () => {
  it('takes a rich message, a slot under it, the primary style, the in-row look and a label kept while busy', () => {
    render(
      <InPlaceConfirm
        {...LABELS}
        message={
          <>
            <bdi>sara@studio.example</bdi> can sign in.
          </>
        }
        variant="primary"
        appearance="row"
        keepLabelWhileLoading
        busy
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      >
        <p role="alert">Your passkey wasn’t accepted.</p>
      </InPlaceConfirm>,
    );
    const group = screen.getByRole('group', { name: 'sara@studio.example can sign in.' });
    expect(group).toHaveClass('hp-passkey-confirm');
    expect(group).not.toHaveClass('hp-confirm');
    expect(screen.getByRole('alert')).toHaveTextContent('Your passkey wasn’t accepted.');
    const action = screen.getByRole('button', { name: /Delete/ });
    expect(action).toHaveClass('btn-primary');
    expect(action).toHaveTextContent('Delete');
  });

  it('with cancelWhileBusy off, a confirm in flight can be neither cancelled nor escaped: its answer belongs to it', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<InPlaceConfirm {...LABELS} busy cancelWhileBusy={false} onCancel={onCancel} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('useConfirmStep', () => {
  function Harness() {
    const { open, ask, cancel, triggerRef } = useConfirmStep();
    return open ? (
      <InPlaceConfirm {...LABELS} onCancel={cancel} onConfirm={vi.fn()} />
    ) : (
      <button type="button" ref={triggerRef} onClick={ask}>
        Delete
      </button>
    );
  }

  it('opens the confirm from its trigger and gives focus back to the trigger on cancel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('group', { name: LABELS.message })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus());
  });
});
