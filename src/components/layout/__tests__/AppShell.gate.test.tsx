/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db } from '../../../db/database';
import { BusinessesGate } from '../AppShell';
import type { BusinessProfile } from '../../../types';

/**
 * MUT-89 D8: no page reads with a blank business. A blank business means
 * "every record" to the repositories, so while the businesses load the
 * routed page is held back, the way AppShell already holds it while the
 * visitor sample is prepared. One gate covers every page.
 */

const STAMP = '2026-09-01T00:00:00.000Z';
const studio: BusinessProfile = { id: 'studio', name: 'Studio', isDefault: true, createdAt: STAMP, updatedAt: STAMP };

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessesGate>
        <p>the page</p>
      </BusinessesGate>
    </QueryClientProvider>,
  );
}

describe('BusinessesGate', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
  });

  it('holds the page back until the businesses have loaded, then mounts it', async () => {
    await db.businessProfiles.add(studio);
    renderGate();

    expect(screen.queryByText('the page')).not.toBeInTheDocument();
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });

  it('mounts the page when there is no business yet (D4: before Welcome creates one)', async () => {
    renderGate();
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });
});
