import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityTypeahead, type TypeaheadOption } from '../../components/ui/EntityTypeahead';
import { useProjectDirectory } from '../data/queries';
import type { Project } from '../api/client';

/**
 * The hosted expense drawer's project (matter) field (MUT-44). See
 * ClientPicker's doc comment — same reasoning, same reuse of EntityTypeahead,
 * same read-only directory, no create-new branch.
 */
export interface ProjectPickerProps {
  profileId: string;
  customerId?: string;
  value: string;
  onChange: (projectId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ProjectPicker({ profileId, customerId, value, onChange, placeholder, disabled }: ProjectPickerProps) {
  const { data: projects } = useProjectDirectory(profileId, customerId);
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

  const options: TypeaheadOption<Project>[] = useMemo(() => {
    if (!projects) return [];
    const trimmed = inputValue.trim().toLowerCase();
    const list = Array.from(projects.values());
    const matched = trimmed ? list.filter((p) => p.name.toLowerCase().includes(trimmed)) : list;
    return matched.map((p) => ({ id: p.id, label: p.name, isNew: false, item: p }));
  }, [projects, inputValue]);

  return (
    <EntityTypeahead<Project>
      options={options}
      inputValue={inputValue}
      onInputChange={(next) => {
        setInputValue(next);
        if (!next.trim()) onChange('');
      }}
      onSelect={(option) => {
        setInputValue(option.label);
        onChange(option.id);
      }}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}
