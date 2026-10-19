import { useCallback, useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useClientProjectCascade } from '../../lib/forms/useClientProjectCascade';
import { useProjectDirectory } from '../data/queries';
import type { Project } from '../api/client';

const ownerOf = (matter: Project) => matter.customerId;

/**
 * The local app's client ↔ matter cascade in a hosted drawer (MUT-318, design review 2A): picking a matter with no client
 * fills the client, and a client change clears a matter of another client. Read over every client's matters. Returns a
 * counter for the client field's `flashSignal`, so a filled client shows where it came from (Apple design review A3).
 */
export function useMatterCascade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the shared hook takes any form, as the local drawers' do
  form: UseFormReturn<any>,
  profileId: string,
  clientFieldName: string,
): number {
  const { data: matters } = useProjectDirectory(profileId);
  const projectsData = useMemo(() => (matters ? Array.from(matters.values()) : []), [matters]);
  const [clientFlash, setClientFlash] = useState(0);
  const onAutoFill = useCallback(() => setClientFlash((n) => n + 1), []);
  useClientProjectCascade({ form, projectsData, ownerOf, clientFieldName, onAutoFill });
  return clientFlash;
}
