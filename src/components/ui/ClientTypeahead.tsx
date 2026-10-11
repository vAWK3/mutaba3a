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
  /**
   * Reports text left in the box that is not a picked client ('' when there
   * is none), so a form can refuse to save instead of silently dropping it.
   */
  onPendingTextChange?: (text: string) => void;
  /**
   * True while a client picked from the "create" option is being saved, false
   * once it exists (its id has then been passed to onChange).
   */
  onCreatingChange?: (creating: boolean) => void;
}

export function ClientTypeahead({
  value,
  onChange,
  profileId,
  placeholder,
  disabled,
  className,
  onPendingTextChange,
  onCreatingChange,
}: ClientTypeaheadProps) {
  const t = useT();
  const [inputValue, setInputValue] = useState('');
  // The label last picked: a client created from "create" counts as picked
  // before the clients list has refetched it.
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const selectedName = activeClients.find((c) => c.id === value)?.name;
  const pickedLabel = value || creating ? pickedName : null;
  const trimmedInput = inputValue.trim();
  const pendingText =
    trimmedInput && inputValue !== selectedName && inputValue !== pickedLabel ? trimmedInput : '';

  // Report only real changes, so a parent passing an inline callback can't loop.
  const reportedPendingText = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (reportedPendingText.current === pendingText) return;
    reportedPendingText.current = pendingText;
    onPendingTextChange?.(pendingText);
  }, [pendingText, onPendingTextChange]);

  // Leaving the box with a client's exact name (any case) picks that client.
  const handleBlur = useCallback(() => {
    if (!pendingText) return;
    const match = activeClients.find((c) => c.name.toLowerCase() === pendingText.toLowerCase());
    if (match) {
      setInputValue(match.name);
      setPickedName(match.name);
      onChange(match.id);
    }
  }, [pendingText, activeClients, onChange]);

  const handleInputChange = useCallback((newValue: string) => {
    setInputValue(newValue);
    if (!newValue.trim()) {
      onChange('');
    }
  }, [onChange]);

  const handleSelect = useCallback(
    async (option: TypeaheadOption<Client>) => {
      setPickedName(option.label);
      if (option.isNew) {
        setCreating(true);
        onCreatingChange?.(true);
        try {
          const newClient = await createMutation.mutateAsync({
            name: option.label,
            profileId: profileId || undefined,
          });
          setInputValue(newClient.name);
          setPickedName(newClient.name);
          onChange(newClient.id);
        } catch {
          // Keep the name in the box, unpicked: a form then refuses to save
          // without it (onPendingTextChange) instead of saving with no client.
          setInputValue(option.label);
          setPickedName(null);
          onChange('');
        } finally {
          setCreating(false);
          onCreatingChange?.(false);
        }
      } else {
        setInputValue(option.label);
        onChange(option.id);
      }
    },
    [createMutation, onChange, onCreatingChange, profileId]
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
      onBlur={handleBlur}
    />
  );
}
