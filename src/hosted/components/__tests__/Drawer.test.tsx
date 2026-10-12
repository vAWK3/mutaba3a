import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Drawer } from '../Drawer';

// TD-009: the portal's drawer had the app drawer's unnamed role="dialog"
describe('hosted Drawer', () => {
  it('is a dialog named by its title', () => {
    render(
      <Drawer title="New expense" onClose={vi.fn()} closeLabel="Close">
        body
      </Drawer>,
    );

    expect(screen.getByRole('dialog', { name: 'New expense' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
