import { StrictMode, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test/utils';
import { useProfileStore } from '../../lib/profileStore';
import { useSampleSessionStore } from '../sampleSessionStore';
import { writeSampleSession } from '../sampleSession';
import { useVisitorSampleEntry } from '../useVisitorSample';

const entry = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../visitorSample', () => ({
  enterVisitorSample: async () => {
    entry.calls += 1;
    writeSampleSession({ profileId: 'demo_profile_002', enabledFeatures: [], startedAt: new Date().toISOString() });
    return { kind: 'sample', profileId: 'demo_profile_002' };
  },
  leaveVisitorSample: async () => {},
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
    </StrictMode>
  );
}

beforeEach(() => {
  localStorage.clear();
  entry.calls = 0;
  useSampleSessionStore.setState({ status: 'none' });
  useProfileStore.setState({ activeProfileId: '' });
});

describe('useVisitorSampleEntry', () => {
  it('opens the sample once, even under StrictMode, and selects its business', async () => {
    window.history.replaceState({}, '', '/app/clients?sample=1');

    renderHook(() => useVisitorSampleEntry(), { wrapper });

    await waitFor(() => expect(useSampleSessionStore.getState().status).toBe('active'));
    expect(useProfileStore.getState().activeProfileId).toBe('demo_profile_002');
    expect(entry.calls).toBe(1);
    expect(window.location.search).toBe('');
  });

  it('does nothing without the sample parameter', async () => {
    window.history.replaceState({}, '', '/app/clients');

    renderHook(() => useVisitorSampleEntry(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entry.calls).toBe(0);
    expect(useSampleSessionStore.getState().status).toBe('none');
  });
});
