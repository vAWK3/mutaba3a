import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { EntityTypeahead, type TypeaheadOption } from '../../components/ui/EntityTypeahead';
import { useT } from '../../lib/i18n/core';
import { useCustomerDirectory, useProjectDirectory } from '../data/queries';
import { useCreateProject } from '../data/projectQueries';
import { useToast } from './Toast';
import type { Currency, Project } from '../api/client';

/**
 * The hosted drawers' matter (project) field (MUT-44). See ClientPicker's doc comment — same reasoning, same reuse of
 * EntityTypeahead.
 *
 * MUT-318: where the person may add matters (`canCreate`, from `canAddClient(profile)`: `projects` is profile-dependent
 * exactly like `customers`), a typed name the chosen client has no matter for gets an "Add matter: «name»" row, created
 * under that client in the drawer's `currency`. A matter needs a client, so with none chosen there is no Add row and a
 * hint says why (read with the input, announced when it appears). With no client chosen each matter names its client.
 * The drawer's useClientProjectCascade fills the client from a picked matter and clears a matter of another client.
 */
export interface ProjectPickerProps {
  profileId: string;
  customerId?: string;
  value: string;
  onChange: (projectId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** The input's id, so the drawer's `<label htmlFor>` names it. */
  id?: string;
  /** Offer "Add matter: «name»" for a name the chosen client has no matter for (MUT-318). */
  canCreate?: boolean;
  /** The currency a new matter is opened in: the drawer's (MUT-318). */
  currency?: Currency;
  /** Told when an Add «name» starts and ends, so the drawer holds Save meanwhile (MUT-318, usePendingPicks). */
  onCreatingChange?: (creating: boolean) => void;
}

const NEW_OPTION_ID = 'new';

export function ProjectPicker({ profileId, customerId, value, onChange, placeholder, disabled, id, canCreate = false, currency, onCreatingChange }: ProjectPickerProps) {
  const t = useT();
  const toast = useToast();
  const hintId = useId();
  const { data: projects } = useProjectDirectory(profileId, customerId);
  const { data: customers } = useCustomerDirectory(profileId);
  const createProject = useCreateProject(profileId);
  const [inputValue, setInputValue] = useState('');
  const prevValue = useRef(value);

  useEffect(() => {
    if (value) {
      const project = projects?.get(value);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync displayed input with the value prop, same pattern as the local app's ProjectTypeahead
      if (project) setInputValue(project.name);
    } else if (prevValue.current) {
      setInputValue('');
    }
    prevValue.current = value;
  }, [value, projects]);

  const trimmed = inputValue.trim();
  const list = useMemo(() => (projects ? Array.from(projects.values()) : []), [projects]);
  const isUnknownName = trimmed !== '' && !list.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const offersAdd = canCreate && Boolean(customerId) && Boolean(currency) && isUnknownName;
  const needsClient = canCreate && !customerId && isUnknownName;

  const options: TypeaheadOption<Project>[] = useMemo(() => {
    if (!projects) return [];
    const lower = trimmed.toLowerCase();
    const matched = lower ? list.filter((p) => p.name.toLowerCase().includes(lower)) : list;
    const results: TypeaheadOption<Project>[] = matched.map((p) => ({
      id: p.id,
      label: p.name,
      isNew: false,
      item: p,
      // With no client chosen the list mixes every client's matters: name whose each one is (design review 1A)
      secondary: customerId ? undefined : customers?.get(p.customerId)?.name,
    }));
    if (offersAdd) results.push({ id: NEW_OPTION_ID, label: trimmed, isNew: true });
    return results;
  }, [projects, list, trimmed, offersAdd, customerId, customers]);

  async function select(option: TypeaheadOption<Project>): Promise<boolean> {
    if (!option.isNew) {
      setInputValue(option.label);
      onChange(option.id);
      return true;
    }
    onCreatingChange?.(true);
    try {
      const created = await createProject.mutateAsync({ customerId: customerId!, name: option.label, currency: currency! });
      onCreatingChange?.(false);
      setInputValue(created.name);
      // The directory hasn't refetched yet; the sync effect mustn't clear the name it can't find.
      prevValue.current = created.id;
      onChange(created.id);
      return true;
    } catch {
      // No `finally` (the React Compiler skips a component that has one): each path reports the end itself
      onCreatingChange?.(false);
      // As ClientPicker: the name stays in the box, unpicked, and any matter picked before it is dropped.
      setInputValue(option.label);
      prevValue.current = '';
      onChange('');
      toast(t('hosted.matters.addFailed'));
      return false;
    }
  }

  return (
    <>
      <EntityTypeahead<Project>
        options={options}
        inputValue={inputValue}
        onInputChange={(next) => {
          setInputValue(next);
          if (!next.trim()) onChange('');
        }}
        onSelect={select}
        placeholder={placeholder}
        disabled={disabled}
        createLabel={t('hosted.matters.add')}
        id={id}
        describedBy={canCreate ? hintId : undefined}
      />
      {canCreate && (
        // Always mounted, empty when it doesn't apply: a live region must exist before its text changes to be announced
        <p id={hintId} className="form-hint" aria-live="polite" style={needsClient ? undefined : { margin: 0 }}>
          {needsClient ? t('hosted.matters.needsClient') : ''}
        </p>
      )}
    </>
  );
}
