import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { useClientProjectCascade } from '../useClientProjectCascade';
import type { Project } from '../../types';

// Test helper: renders a component that uses the cascade hook and exposes form methods
function createTestHarness(projectsData: Project[]) {
  const formRef: { current: ReturnType<typeof useForm> | null } = { current: null };
  const cascadeRef: { current: ReturnType<typeof useClientProjectCascade> | null } = { current: null };

  function TestComponent() {
    const form = useForm({
      defaultValues: { clientId: '', projectId: '' },
    });
    const cascade = useClientProjectCascade({ form, projectsData });
    formRef.current = form;
    cascadeRef.current = cascade;
    return null;
  }

  render(<TestComponent />);
  return { form: formRef.current!, cascade: cascadeRef.current! };
}

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Test Project',
  profileId: 'profile-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('useClientProjectCascade', () => {
  const projectWithClient = makeProject({ id: 'proj-a', name: 'Project A', clientId: 'client-a' });
  const projectWithoutClient = makeProject({ id: 'proj-b', name: 'Project B' });
  const projectWithClientB = makeProject({ id: 'proj-c', name: 'Project C', clientId: 'client-b' });

  it('clears project when client changes and project belongs to different client', () => {
    const { form } = createTestHarness([projectWithClient]);

    // Set both fields: client-a owns proj-a
    act(() => {
      form.setValue('clientId', 'client-a');
      form.setValue('projectId', 'proj-a');
    });

    // Change client to client-b => proj-a belongs to client-a, should clear
    act(() => {
      form.setValue('clientId', 'client-b');
    });

    // Wait for cascade effect
    expect(form.getValues('projectId')).toBe('');
  });

  it('auto-fills client when project with clientId is selected', () => {
    const { form } = createTestHarness([projectWithClient]);

    // Select project that has clientId
    act(() => {
      form.setValue('projectId', 'proj-a');
    });

    expect(form.getValues('clientId')).toBe('client-a');
  });

  it('does not change client when project has no clientId', () => {
    const { form } = createTestHarness([projectWithoutClient]);

    act(() => {
      form.setValue('clientId', 'client-x');
    });

    act(() => {
      form.setValue('projectId', 'proj-b');
    });

    // Client should stay as client-x
    expect(form.getValues('clientId')).toBe('client-x');
  });

  it('does NOT clear project when auto-filled client is cleared (provenance)', () => {
    const { form } = createTestHarness([projectWithClient]);

    // User selects project => client auto-filled
    act(() => {
      form.setValue('projectId', 'proj-a');
    });
    expect(form.getValues('clientId')).toBe('client-a');

    // User clears client => project should STAY (client was auto-filled)
    act(() => {
      form.setValue('clientId', '');
    });

    expect(form.getValues('projectId')).toBe('proj-a');
  });

  it('clears mismatched project when explicitly-set client is cleared', () => {
    const { form } = createTestHarness([projectWithClient]);

    // User explicitly sets client, then project
    act(() => {
      form.setValue('clientId', 'client-a');
    });
    act(() => {
      form.setValue('projectId', 'proj-a');
    });

    // User clears client => project should clear (client was explicit)
    act(() => {
      form.setValue('clientId', '');
    });

    expect(form.getValues('projectId')).toBe('');
  });

  it('does NOT clear client when project is cleared', () => {
    const { form } = createTestHarness([projectWithClient]);

    act(() => {
      form.setValue('clientId', 'client-a');
      form.setValue('projectId', 'proj-a');
    });

    act(() => {
      form.setValue('projectId', '');
    });

    // Client should stay
    expect(form.getValues('clientId')).toBe('client-a');
  });

  it('overrides client when project belongs to different client', () => {
    const { form } = createTestHarness([projectWithClient, projectWithClientB]);

    // Set client-a explicitly
    act(() => {
      form.setValue('clientId', 'client-a');
    });

    // Select project belonging to client-b => should override client
    act(() => {
      form.setValue('projectId', 'proj-c');
    });

    expect(form.getValues('clientId')).toBe('client-b');
  });
});
