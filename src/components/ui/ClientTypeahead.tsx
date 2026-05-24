import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useClients, useCreateClient } from '../../hooks/useQueries';
import { useT } from '../../lib/i18n';
import { EntityTypeahead, type TypeaheadOption } from './EntityTypeahead';
import type { Client } from '../../types';

export interface ClientTypeaheadProps {
  value: string; // clientId
  onChange: (clientId: string) => void;
  profileId?: string; // used ONLY for create call, NOT for filtering
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ClientTypeahead({
  value,
  onChange,
  profileId,
  placeholder,
  disabled,
  className,
}: ClientTypeaheadProps) {
  const t = useT();
  const [inputValue, setInputValue] = useState('');

  const { data: allClients = [] } = useClients();
  const createMutation = useCreateClient();

  // Filter out archived clients (clients are shared across profiles, no profileId filter)
  const activeClients = useMemo(() => {
    return allClients.filter((c) => !c.archivedAt);
  }, [allClients]);

  // Sync input display with selected client value (prefill pattern from ProjectTypeahead:46-59)
  const prevValue = useRef(value);
  useEffect(() => {
    if (value) {
      const client = activeClients.find((c) => c.id === value);
      if (client) {
        setInputValue(client.name);
      }
    } else if (prevValue.current) {
      setInputValue('');
    }
    prevValue.current = value;
  }, [value, activeClients]);

  // Build typeahead options from active clients + input
  const options: TypeaheadOption<Client>[] = useMemo(() => {
    const trimmed = inputValue.trim().toLowerCase();

    const matched = trimmed
      ? activeClients.filter((c) =>
          c.name.toLowerCase().includes(trimmed)
        )
      : activeClients;

    const results: TypeaheadOption<Client>[] = matched.map((c) => ({
      id: c.id,
      label: c.name,
      isNew: false,
      item: c,
    }));

    // Add "Create new" if no exact name match and input is non-empty
    if (trimmed) {
      const hasExactMatch = activeClients.some(
        (c) => c.name.toLowerCase() === trimmed
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
  }, [inputValue, activeClients]);

  const handleInputChange = useCallback((newValue: string) => {
    setInputValue(newValue);
    if (!newValue.trim()) {
      onChange('');
    }
  }, [onChange]);

  const handleSelect = useCallback(
    async (option: TypeaheadOption<Client>) => {
      if (option.isNew) {
        try {
          const newClient = await createMutation.mutateAsync({
            name: option.label,
            profileId: profileId || undefined,
          });
          setInputValue(newClient.name);
          onChange(newClient.id);
        } catch {
          setInputValue('');
          onChange('');
        }
      } else {
        setInputValue(option.label);
        onChange(option.id);
      }
    },
    [createMutation, onChange, profileId]
  );

  return (
    <EntityTypeahead<Client>
      options={options}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onSelect={handleSelect}
      placeholder={placeholder || t('drawer.transaction.clientPlaceholder')}
      disabled={disabled}
      className={className}
      createLabel={t('client.createNew')}
    />
  );
}
