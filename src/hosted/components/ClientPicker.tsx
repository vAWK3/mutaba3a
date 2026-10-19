import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityTypeahead, type TypeaheadOption } from '../../components/ui/EntityTypeahead';
import { useT } from '../../lib/i18n/core';
import { useCustomerDirectory } from '../data/queries';
import { useCreateCustomer } from '../data/customerQueries';
import { useToast } from './Toast';
import type { Customer } from '../api/client';

/**
 * The hosted drawers' client field (MUT-44, MUT-133). Reuses EntityTypeahead's
 * presentational core, fed by the customer directory the portal already loads
 * for name resolution elsewhere — not the local app's ClientTypeahead, which
 * is Dexie-backed.
 *
 * MUT-286: where the person may add clients (`canCreate`, from
 * `canAddClient(profile)`: a profile they own, which every profile signed out
 * is), a typed name no client has gets an "Add client: «name»" row, and picking
 * it creates the client there and then, as the local app's ClientTypeahead
 * does. Elsewhere (a Malafat-fed profile, a firm) the row never appears:
 * Malafat or the firm owns the client list.
 */
export interface ClientPickerProps {
  profileId: string;
  value: string;
  onChange: (customerId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** The input's id, so the drawer's `<label htmlFor>` names it. */
  id?: string;
  /** Offer "Add client: «name»" for a name no client has (MUT-286). */
  canCreate?: boolean;
}

const NEW_OPTION_ID = 'new';

export function ClientPicker({ profileId, value, onChange, placeholder, disabled, id, canCreate = false }: ClientPickerProps) {
  const t = useT();
  const toast = useToast();
  const { data: customers } = useCustomerDirectory(profileId);
  const createCustomer = useCreateCustomer(profileId);
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
    const trimmed = inputValue.trim();
    const lower = trimmed.toLowerCase();
    const list = Array.from(customers.values());
    const matched = lower ? list.filter((c) => c.name.toLowerCase().includes(lower)) : list;
    const results: TypeaheadOption<Customer>[] = matched.map((c) => ({ id: c.id, label: c.name, isNew: false, item: c }));
    if (canCreate && trimmed && !list.some((c) => c.name.toLowerCase() === lower)) {
      results.push({ id: NEW_OPTION_ID, label: trimmed, isNew: true });
    }
    return results;
  }, [customers, inputValue, canCreate]);

  async function select(option: TypeaheadOption<Customer>): Promise<boolean> {
    if (!option.isNew) {
      setInputValue(option.label);
      onChange(option.id);
      return true;
    }
    try {
      const created = await createCustomer.mutateAsync(option.label);
      setInputValue(created.name);
      // The directory hasn't refetched yet; the sync effect mustn't clear the name it can't find.
      prevValue.current = created.id;
      onChange(created.id);
      return true;
    } catch {
      // Keep the name in the box, unpicked, so the form still refuses to save without a client.
      setInputValue(option.label);
      toast(t('hosted.clients.addFailed'));
      return false;
    }
  }

  return (
    <EntityTypeahead<Customer>
      options={options}
      inputValue={inputValue}
      onInputChange={(next) => {
        setInputValue(next);
        if (!next.trim()) onChange('');
      }}
      onSelect={select}
      placeholder={placeholder}
      disabled={disabled || createCustomer.isPending}
      createLabel={t('hosted.clients.add')}
      id={id}
    />
  );
}
