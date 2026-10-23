import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LastResortBoundary } from '../LastResortBoundary';

const { reportBoundaryError } = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock('../errorReporting', () => ({ reportBoundaryError }));

function Broken(): never {
  throw new Error('a provider broke');
}

/** MUT-149 design D8: above every provider, so it can rely on none of them: no language, no theme, no router. */
describe('LastResortBoundary', () => {
  it('shows the crash copy in Arabic first, then English, with one Reload, and reports the crash', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <LastResortBoundary>
        <Broken />
      </LastResortBoundary>,
    );
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['توقفت هذه الصفحة عن العمل', 'This page stopped working']);
    expect(screen.getByRole('heading', { name: 'توقفت هذه الصفحة عن العمل' }).closest('[lang]')).toHaveAttribute('dir', 'rtl');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('a provider broke');
    expect(reportBoundaryError).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('renders its children when nothing breaks', () => {
    render(<LastResortBoundary>fine</LastResortBoundary>);
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
