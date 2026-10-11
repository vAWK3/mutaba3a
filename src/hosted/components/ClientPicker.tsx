import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityTypeahead, type TypeaheadOption } from '../../components/ui/EntityTypeahead';
import { useCustomerDirectory } from '../data/queries';
import type { Customer } from '../api/client';

/**
 * The hosted expense drawer's client field (MUT-44). Reuses EntityTypeahead's
 * presentational core, fed by the read-only customer directory the portal
 * already loads for name resolution elsewhere — not the local app's
 * ClientTypeahead, which is Dexie-backed and lets you create a client inline.
 * MUT-42 D6 validates customerId/projectId against existing organization
 * records only, so there is nothing to create here: the "new" branch of
 * EntityTypeahead's option list is simply never produced.
 */
export interface ClientPickerProps {
  profileId: string;
  value: string;
  onChange: (customerId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ClientPicker({ profileId, value, onChange, placeholder, disabled }: ClientPickerProps) {
  const { data: customers } = useCustomerDirectory(profileId);
  const [inputValue, setInputValue] = useState('');
  const prevValue = useRef(value);

  // Sync the displayed text with the value prop (selection, prefill, reset) —
  // same pattern as the local app's ClientTypeahead/ProjectTypeahead.
  useEffect(() => {
    if (value) {
      const customer = customers?.get(value);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync displayed input with the value prop, same pattern as the local app's ClientTypeahead
      if (customer) setInputValue(customer.name);
    } else if (prevValue.current) {
      setInputValue('');
    }
    prevValue.current = value;
  }, [value, customers]);

  const options: TypeaheadOption<Customer>[] = useMemo(() => {
    if (!customers) return [];
    const trimmed = inputValue.trim().toLowerCase();
    const list = Array.from(customers.values());
    const matched = trimmed ? list.filter((c) => c.name.toLowerCase().includes(trimmed)) : list;
    return matched.map((c) => ({ id: c.id, label: c.name, isNew: false, item: c }));
  }, [customers, inputValue]);

  return (
    <EntityTypeahead<Customer>
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
