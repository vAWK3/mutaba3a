/**
 * @vitest-environment jsdom
 *
 * MUT-89: the top bar names the business a page works in, or "All
 * businesses" on Home and Clients while the lens is on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActiveProfileIndicator } from '../TopBar';
import type { BusinessProfile } from '../../../types';

const STAMP = '2026-01-01T00:00:00Z';
const studio: BusinessProfile = { id: 'p1', name: 'Studio', createdAt: STAMP, updatedAt: STAMP };
const teaching: BusinessProfile = { id: 'p2', name: 'Teaching', createdAt: STAMP, updatedAt: STAMP };

const active = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../hooks/useActiveProfile', () => ({ useActiveProfile: () => active.current }));
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => ({ 'profileSwitcher.allProfiles': 'All businesses' })[key] ?? key,
}));

describe('ActiveProfileIndicator', () => {
  it('names the working business', () => {
    active.current = { activeProfile: studio, profiles: [studio, teaching], isAllProfiles: false };
    render(<ActiveProfileIndicator />);
    expect(screen.getByText('Studio')).toBeInTheDocument();
  });

  it('says All businesses while the lens is on (MUT-89)', () => {
    active.current = { activeProfile: studio, profiles: [studio, teaching], isAllProfiles: true };
    render(<ActiveProfileIndicator />);
    expect(screen.getByText('All businesses')).toBeInTheDocument();
    expect(screen.queryByText('Studio')).toBeNull();
  });

  it('stays hidden with one business', () => {
    active.current = { activeProfile: studio, profiles: [studio], isAllProfiles: false };
    const { container } = render(<ActiveProfileIndicator />);
    expect(container).toBeEmptyDOMElement();
  });
});
