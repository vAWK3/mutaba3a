import { useState, useEffect, useCallback, useMemo } from 'react';
import { useVendors, useFindOrCreateVendor } from '../../hooks/useExpenseQueries';
import { normalizeVendor, vendorSimilarity } from '../../lib/vendorNormalization';
import { useT } from '../../lib/i18n';
import { EntityTypeahead, type TypeaheadOption } from './EntityTypeahead';
import type { Vendor } from '../../types';

export interface VendorTypeaheadProps {
  profileId: string;
  value: string;
  vendorId?: string;
  onChange: (value: string, vendorId?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function VendorTypeahead({
  profileId,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: VendorTypeaheadProps) {
  const t = useT();
  const [inputValue, setInputValue] = useState(value);

  const { data: vendors = [] } = useVendors(profileId);
  const findOrCreateMutation = useFindOrCreateVendor();

  // Sync input value with external value prop
  useEffect(() => {
    if (value !== inputValue) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputValue(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Filter and score vendors based on input
  const options: TypeaheadOption<Vendor>[] = useMemo(() => {
    if (!inputValue.trim()) {
      return vendors.map((v) => ({
        id: v.id,
        label: v.canonicalName,
        isNew: false,
        item: v,
      }));
    }

    const normalizedInput = normalizeVendor(inputValue);
    const scored: Array<{ vendor: Vendor; score: number }> = [];

    for (const vendor of vendors) {
      const canonicalScore = vendorSimilarity(inputValue, vendor.canonicalName);
      let bestScore = canonicalScore;

      for (const alias of vendor.aliases) {
        const aliasScore = vendorSimilarity(inputValue, alias);
        if (aliasScore > bestScore) {
          bestScore = aliasScore;
        }
      }

      if (bestScore > 0.3 || vendor.canonicalName.toLowerCase().includes(normalizedInput)) {
        scored.push({ vendor, score: bestScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const results: TypeaheadOption<Vendor>[] = scored.map(({ vendor, score }) => ({
      id: vendor.id,
      label: vendor.canonicalName,
      isNew: false,
      item: vendor,
      secondary: score < 1 ? `${Math.round(score * 100)}%` : undefined,
    }));

    // Add "Create new" option if no exact match
    const hasExactMatch = scored.some((s) => s.score >= 0.95);
    if (!hasExactMatch && inputValue.trim()) {
      results.push({
        id: 'new',
        label: inputValue.trim(),
        isNew: true,
      });
    }

    return results;
  }, [inputValue, vendors]);

  const handleInputChange = useCallback(
    (newValue: string) => {
      setInputValue(newValue);
      onChange(newValue, undefined);
    },
    [onChange]
  );

  const handleSelect = useCallback(
    async (option: TypeaheadOption<Vendor>) => {
      if (option.isNew) {
        try {
          const newVendor = (await findOrCreateMutation.mutateAsync({
            profileId,
            rawVendor: option.label,
          })) as { id: string; canonicalName: string };
          setInputValue(newVendor.canonicalName);
          onChange(newVendor.canonicalName, newVendor.id);
        } catch {
          setInputValue(option.label);
          onChange(option.label, undefined);
        }
      } else {
        setInputValue(option.label);
        onChange(option.label, option.id);
      }
    },
    [findOrCreateMutation, onChange, profileId]
  );

  return (
    <EntityTypeahead<Vendor>
      options={options}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onSelect={handleSelect}
      placeholder={placeholder || t('drawer.expense.vendorPlaceholder')}
      disabled={disabled}
      className={className}
      createLabel={t('vendor.createNew')}
    />
  );
}
