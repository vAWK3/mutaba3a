import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

  // AC1 (MUT-91): the portal reuses the shared spring drawer (MUT-80, R2), not a copy.
  it('is the shared DrawerFrame: its classes, and its close button presses (L10)', () => {
    render(
      <Drawer title="New expense" onClose={vi.fn()} closeLabel="Close">
        body
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New expense' });
    expect(dialog).toHaveClass('drawer');
    expect(dialog.querySelector('.drawer-body')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('drawer-close', 'press');
  });

  it('no portal source but this wrapper builds a dialog of its own', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
        return /\.tsx?$/.test(name) ? [path] : [];
      });
    const own = files('src/hosted').filter((path) => /role=["']dialog["']|aria-modal/.test(readFileSync(path, 'utf8')));
    expect(own).toEqual([]);
    expect(readFileSync('src/hosted/components/Drawer.tsx', 'utf8')).toMatch(/from '\.\.\/\.\.\/components\/ui\/drawer\/DrawerFrame'/);
  });
});
