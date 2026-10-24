import { useEffect, useMemo, useState } from 'react';
import { EntityTypeahead, type TypeaheadOption } from '../../components/ui/EntityTypeahead';
import { useT } from '../../lib/i18n/core';
import { useVendorSuggestions } from '../data/expenseQueries';
import type { VendorSuggestion } from '../api/client';

/**
 * The hosted expense drawer's vendor field (MUT-254, ADR-183). Free text: whatever is typed is the vendor, and the
 * server links it to the profile's saved vendor on save (exact match only, decision V1). This only suggests: the
 * profile's vendors whose name or alias matches what was typed (GET /v1/vendors, fuzzy), the most recently used when
 * the box is empty. Picking one fills its name and tells the drawer (`onPick`), which prefills the vendor's last
 * category when none is chosen yet. Not the local app's VendorTypeahead, which is Dexie-backed.
 */
export interface VendorPickerProps {
  profileId: string;
  value: string;
  onChange: (vendor: string) => void;
  onPick?: (vendor: VendorSuggestion) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** The input's id, so the drawer's `<label htmlFor>` names it. */
  id?: string;
}

const TYPED_OPTION_ID = 'typed';
const DEBOUNCE_MS = 200;

export function VendorPicker({ profileId, value, onChange, onPick, onBlur, placeholder, disabled, id }: VendorPickerProps) {
  const t = useT();
  const [query, setQuery] = useState(value.trim());
  useEffect(() => {
    const timer = setTimeout(() => setQuery(value.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  const { data } = useVendorSuggestions(profileId, query);
  const suggestions = data?.items;
  // The server's own exact match ("Super Deal Ltd" saves as Super Deal), trusted only for the text it was asked about.
  const current = data?.q === value.trim();

  const options: TypeaheadOption<VendorSuggestion>[] = useMemo(() => {
    const typed = value.trim();
    const results: TypeaheadOption<VendorSuggestion>[] = (suggestions ?? []).map((s) => ({
      id: s.id,
      label: s.name,
      isNew: false,
      item: s,
      ...(s.matchedName !== s.name ? { secondary: t('hosted.expenses.drawer.vendorAlias', { name: s.matchedName }) } : {}),
    }));
    // The typed text is a vendor of its own unless it saves as a suggestion (the server says `exact`: "Super Deal
    // Ltd" is Super Deal, "احمد" is أحمد); while the answer is for older text, a plain spelling match stands in.
    const spelled = (suggestions ?? []).some((s) => (current ? s.exact : [s.name, s.matchedName].some((n) => n.toLowerCase() === typed.toLowerCase())));
    if (typed && !spelled) results.push({ id: TYPED_OPTION_ID, label: typed, isNew: true });
    return results;
  }, [suggestions, current, value, t]);

  // Enter keeps what was typed (or the suggestion the server would match it to), never a suggestion that merely
  // starts with it: "Super" stays Super unless Super Deal is picked.
  const autoHighlight = (opts: TypeaheadOption<VendorSuggestion>[], typed: string) => {
    const lower = typed.trim().toLowerCase();
    const exact = opts.findIndex((o) => !o.isNew && o.item && (current ? o.item.exact : [o.item.name, o.item.matchedName].some((n) => n.toLowerCase() === lower)));
    return exact >= 0 ? exact : opts.findIndex((o) => o.isNew);
  };

  function select(option: TypeaheadOption<VendorSuggestion>) {
    onChange(option.label);
    if (option.item) onPick?.(option.item);
  }

  return (
    <EntityTypeahead<VendorSuggestion>
      options={options}
      inputValue={value}
      onInputChange={onChange}
      onSelect={select}
      onBlur={onBlur}
      autoHighlight={autoHighlight}
      placeholder={placeholder}
      disabled={disabled}
      createLabel={t('hosted.expenses.drawer.vendorNew')}
      id={id}
    />
  );
}
