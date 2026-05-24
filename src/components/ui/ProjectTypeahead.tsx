import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProjects, useCreateProject } from '../../hooks/useQueries';
import { useT } from '../../lib/i18n';
import { EntityTypeahead, type TypeaheadOption } from './EntityTypeahead';
import type { Project } from '../../types';

export interface ProjectTypeaheadProps {
  profileId: string;
  clientId?: string;
  value: string; // projectId
  onChange: (projectId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ProjectTypeahead({
  profileId,
  clientId,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: ProjectTypeaheadProps) {
  const t = useT();
  const [inputValue, setInputValue] = useState('');

  const { data: allProjects = [] } = useProjects();
  const createMutation = useCreateProject();

  // Filter projects: by profile, then by client (including clientless projects)
  const filteredProjects = useMemo(() => {
    return allProjects.filter((p) => {
      if (p.archivedAt) return false;
      if (profileId && p.profileId !== profileId) return false;
      if (clientId) {
        // Show projects belonging to selected client OR projects with no client
        return !p.clientId || p.clientId === clientId;
      }
      return true;
    });
  }, [allProjects, profileId, clientId]);

  // Sync input display with selected project value
  const prevValue = useRef(value);
  useEffect(() => {
    if (value) {
      const project = filteredProjects.find((p) => p.id === value);
      if (project) {
        setInputValue(project.name);
      }
    } else if (prevValue.current) {
      // Only clear input when value transitions from set to empty (parent cleared it)
      // Don't clear when value stays empty while filteredProjects changes
      setInputValue('');
    }
    prevValue.current = value;
  }, [value, filteredProjects]);

  // Build typeahead options from filtered projects + input
  const options: TypeaheadOption<Project>[] = useMemo(() => {
    const trimmed = inputValue.trim().toLowerCase();

    const matched = trimmed
      ? filteredProjects.filter((p) =>
          p.name.toLowerCase().includes(trimmed)
        )
      : filteredProjects;

    const results: TypeaheadOption<Project>[] = matched.map((p) => ({
      id: p.id,
      label: p.name,
      isNew: false,
      item: p,
    }));

    // Add "Create new" if no exact name match and input is non-empty
    if (trimmed) {
      const hasExactMatch = filteredProjects.some(
        (p) => p.name.toLowerCase() === trimmed
      );
      if (!hasExactMatch) {
        results.push({
          id: 'new',
          label: inputValue.trim(),
          isNew: true,
        });
      }
    }

    return results;
  }, [inputValue, filteredProjects]);

  const handleInputChange = useCallback((newValue: string) => {
    setInputValue(newValue);
    // If user clears the input, clear the projectId
    if (!newValue.trim()) {
      onChange('');
    }
  }, [onChange]);

  const handleSelect = useCallback(
    async (option: TypeaheadOption<Project>) => {
      if (option.isNew) {
        try {
          const newProject = await createMutation.mutateAsync({
            name: option.label,
            profileId,
            clientId: clientId || undefined,
          });
          setInputValue(newProject.name);
          onChange(newProject.id);
        } catch {
          // If creation fails, revert input
          setInputValue('');
          onChange('');
        }
      } else {
        setInputValue(option.label);
        onChange(option.id);
      }
    },
    [createMutation, onChange, profileId, clientId]
  );

  return (
    <EntityTypeahead<Project>
      options={options}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onSelect={handleSelect}
      placeholder={placeholder || t('drawer.transaction.projectPlaceholder')}
      disabled={disabled}
      className={className}
      createLabel={t('project.createNew')}
    />
  );
}
