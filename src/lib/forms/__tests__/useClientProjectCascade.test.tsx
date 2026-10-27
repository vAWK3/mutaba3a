import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useClientProjectCascade } from '../useClientProjectCascade';
/** The fields the cascade reads from a project (it only needs an id; the client comes through `clientId`). */
interface Project {
  id: string;
  name: string;
  clientId?: string;
}

// Test helper: renders a component that uses the cascade hook and exposes form methods
function createTestHarness(projectsData: Project[]) {
  const formRef: { current: ReturnType<typeof useForm> | null } = { current: null };
  const cascadeRef: { current: ReturnType<typeof useClientProjectCascade> | null } = { current: null };

  function TestComponent() {
    const form = useForm({
      defaultValues: { clientId: '', projectId: '' },
    });
    const cascade = useClientProjectCascade({ form, projectsData });
    // Capture after render (effects flush before render() returns in tests)
    useEffect(() => {
      formRef.current = form;
      cascadeRef.current = cascade;
    });
    return null;
  }

  render(<TestComponent />);
  return { form: formRef.current!, cascade: cascadeRef.current! };
}

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Test Project',
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

  it('reports a fill through onAutoFill with the default owner (clientId), and not when the client already owns it (MUT-318 A3)', () => {
    const onAutoFill = vi.fn();
    const formRef: { current: ReturnType<typeof useForm> | null } = { current: null };
    function TestComponent() {
      const form = useForm({ defaultValues: { clientId: '', projectId: '' } });
      useClientProjectCascade({ form, projectsData: [projectWithClient], onAutoFill });
      useEffect(() => {
        formRef.current = form;
      });
      return null;
    }
    render(<TestComponent />);
    const form = formRef.current!;

    act(() => {
      form.setValue('projectId', 'proj-a');
    });
    expect(form.getValues('clientId')).toBe('client-a');
    expect(onAutoFill).toHaveBeenCalledTimes(1);

    act(() => {
      form.setValue('projectId', '');
    });
    act(() => {
      form.setValue('projectId', 'proj-a');
    });
    expect(onAutoFill).toHaveBeenCalledTimes(1);
  });

  // MUT-318: the hosted drawers use the same hook (a hosted matter's owner is `customerId`) and the client field flashes
  // when the hook fills it (Apple design review A3).
  describe('hosted matters and the auto-fill cue (MUT-318)', () => {
    interface HostedMatter {
      id: string;
      customerId: string;
    }

    function hostedHarness(matters: HostedMatter[], onAutoFill: () => void) {
      const formRef: { current: ReturnType<typeof useForm<{ customerId: string; projectId: string }>> | null } = { current: null };
      function TestComponent() {
        const form = useForm({ defaultValues: { customerId: '', projectId: '' } });
        useClientProjectCascade({
          form,
          projectsData: matters,
          ownerOf: (matter) => matter.customerId,
          clientFieldName: 'customerId',
          onAutoFill,
        });
        useEffect(() => {
          formRef.current = form;
        });
        return null;
      }
      render(<TestComponent />);
      return formRef.current!;
    }

    const matters: HostedMatter[] = [
      { id: 'm1', customerId: 'c1' },
      { id: 'm2', customerId: 'c2' },
    ];

    it('fills the client from the matter through ownerOf, and reports the fill', () => {
      const onAutoFill = vi.fn();
      const form = hostedHarness(matters, onAutoFill);
      act(() => {
        form.setValue('projectId', 'm2');
      });
      expect(form.getValues('customerId')).toBe('c2');
      expect(onAutoFill).toHaveBeenCalledTimes(1);
    });

    it('clears a matter of another client when the client changes, without reporting a fill', () => {
      const onAutoFill = vi.fn();
      const form = hostedHarness(matters, onAutoFill);
      act(() => {
        form.setValue('customerId', 'c1');
      });
      act(() => {
        form.setValue('projectId', 'm1');
      });
      act(() => {
        form.setValue('customerId', 'c2');
      });
      expect(form.getValues('projectId')).toBe('');
      expect(onAutoFill).not.toHaveBeenCalled();
    });

    it('keeps a matter it cannot find yet (just created, list not refetched)', () => {
      const form = hostedHarness(matters, vi.fn());
      act(() => {
        form.setValue('customerId', 'c1');
      });
      act(() => {
        form.setValue('projectId', 'm-new');
      });
      expect(form.getValues('customerId')).toBe('c1');
      expect(form.getValues('projectId')).toBe('m-new');
    });
  });
});
