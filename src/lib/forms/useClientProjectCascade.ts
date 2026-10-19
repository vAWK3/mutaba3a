import { useEffect, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';

interface UseClientProjectCascadeOptions<P extends { id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  projectsData: readonly P[];
  /** Whose project it is: `clientId` by default (the local app); the portal's matters name `customerId` (MUT-318). */
  ownerOf?: (project: P) => string | null | undefined;
  clientFieldName?: string;
  projectFieldName?: string;
  /** Called each time the client is filled from a picked project, so the client field can show it (MUT-318 A3). */
  onAutoFill?: () => void;
}

const clientIdOf = (project: { clientId?: string | null }) => project.clientId;

/**
 * Bi-directional cascade between client and project form fields.
 *
 * Cascade rules:
 * 1. Client changed (explicit) -> clear project if it belongs to a different client
 * 2. Project selected with clientId -> auto-fill client, track as auto-filled
 * 3. Project selected without clientId -> no-op on client
 * 4. Client cleared:
 *    - If auto-filled -> do NOT clear project (project was the explicit choice)
 *    - If explicit -> clear project if it belonged to that client
 * 5. Project cleared -> do NOT clear client (client is higher-level context)
 *
 * Shared by the local drawers and the portal's (MUT-318): it lives in lib/forms because the portal may not import
 * src/hooks/. A project not in `projectsData` (one just created, before its list refetches) is left alone.
 */
export function useClientProjectCascade<P extends { id: string }>({
  form,
  projectsData,
  ownerOf = clientIdOf as (project: P) => string | null | undefined,
  clientFieldName = 'clientId',
  projectFieldName = 'projectId',
  onAutoFill,
}: UseClientProjectCascadeOptions<P>) {
  const { watch, setValue } = form;
  const clientWasAutoFilled = useRef(false);
  const isAutoFilling = useRef(false); // guard: true while project effect is auto-filling client
  const prevClientId = useRef<string>('');
  const prevProjectId = useRef<string>('');

  const clientId = watch(clientFieldName);
  const projectId = watch(projectFieldName);

  // Track client changes and cascade to project
  useEffect(() => {
    const prevClient = prevClientId.current;
    prevClientId.current = clientId || '';

    // Skip initial render
    if (prevClient === (clientId || '')) return;

    // Skip if this change was triggered by auto-fill from project effect
    if (isAutoFilling.current) {
      isAutoFilling.current = false;
      return;
    }

    // Client was cleared
    if (!clientId) {
      if (clientWasAutoFilled.current) {
        // Client was auto-filled from project -> don't clear project
        clientWasAutoFilled.current = false;
        return;
      }
      // Client was explicitly set -> clear project if it belonged to that client
      if (projectId) {
        const project = projectsData.find((p) => p.id === projectId);
        if (project && ownerOf(project) === prevClient) {
          setValue(projectFieldName, '');
        }
      }
      return;
    }

    // Client changed to a new value -> clear mismatched project
    if (projectId) {
      const project = projectsData.find((p) => p.id === projectId);
      if (project && ownerOf(project) && ownerOf(project) !== clientId) {
        setValue(projectFieldName, '');
      }
    }

    // Explicit client selection resets auto-fill tracking
    clientWasAutoFilled.current = false;
  }, [clientId, projectId, projectsData, setValue, projectFieldName, ownerOf]);

  // Track project changes and cascade to client (auto-fill)
  useEffect(() => {
    const prevProject = prevProjectId.current;
    prevProjectId.current = projectId || '';

    // Skip initial render
    if (prevProject === (projectId || '')) return;

    // Project was cleared -> do NOT clear client
    if (!projectId) return;

    // Project selected -> auto-fill client if project has a clientId
    const project = projectsData.find((p) => p.id === projectId);
    const owner = project ? ownerOf(project) : null;
    if (owner && owner !== clientId) {
      clientWasAutoFilled.current = true;
      isAutoFilling.current = true;
      setValue(clientFieldName, owner);
      onAutoFill?.();
    }
  }, [projectId, clientId, projectsData, setValue, clientFieldName, ownerOf, onAutoFill]);

  return { clientWasAutoFilled };
}
