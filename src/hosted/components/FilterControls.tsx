import { useId, useMemo, type ReactNode } from 'react';
import { useLanguage, useT } from '../../lib/i18n/core';
import { Select } from '../../components/ui/Input';
import type { Customer, Project } from '../api/client';

/**
 * Labelled filter controls for the list views. Each reports a single change;
 * the view folds it into its one filters object (house rule).
 */

/** JOD since MUT-194 (TD-117), matching data/filters.ts. */
const CURRENCIES = ['ILS', 'USD', 'EUR', 'JOD'] as const;

function Labelled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="hp-filter">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function byName<T extends { name: string }>(items: Iterable<T>, locale: string): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, locale));
}

interface EntitySelectProps<T> {
  label: string;
  value: string | undefined;
  options: Map<string, T> | undefined;
  onChange: (value: string | undefined) => void;
}

function EntitySelect<T extends { id: string; name: string }>({ label, value, options, onChange }: EntitySelectProps<T>) {
  const { t, language } = useLanguage();
  const sorted = useMemo(() => byName(options?.values() ?? [], language), [options, language]);
  return (
    <Labelled label={label}>
      {(id) => (
        <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{t('hosted.filters.all')}</option>
          {sorted.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      )}
    </Labelled>
  );
}

export function ClientFilter(props: Omit<EntitySelectProps<Customer>, 'label'>) {
  return <EntitySelect label={useT()('hosted.filters.client')} {...props} />;
}

export function MatterFilter(props: Omit<EntitySelectProps<Project>, 'label'>) {
  return <EntitySelect label={useT()('hosted.filters.matter')} {...props} />;
}

export function CategoryFilter(props: Omit<EntitySelectProps<{ id: string; name: string }>, 'label'>) {
  return <EntitySelect label={useT()('hosted.filters.category')} {...props} />;
}

export function CurrencyFilter({ value, onChange }: { value: string | undefined; onChange: (value: (typeof CURRENCIES)[number] | undefined) => void }) {
  const t = useT();
  return (
    <Labelled label={t('hosted.filters.currency')}>
      {(id) => (
        <Select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange((CURRENCIES as readonly string[]).includes(e.target.value) ? (e.target.value as (typeof CURRENCIES)[number]) : undefined)}
        >
          <option value="">{t('hosted.filters.all')}</option>
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </Select>
      )}
    </Labelled>
  );
}

export function SelectFilter<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | undefined;
  options: { value: V; label: string }[];
  onChange: (value: V | undefined) => void;
}) {
  const t = useT();
  return (
    <Labelled label={label}>
      {(id) => (
        <Select id={id} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as V | undefined)}>
          <option value="">{t('hosted.filters.all')}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </Labelled>
  );
}

/** A calendar date (`YYYY-MM-DD`), the shape the API's date filters take. */
export function DateFilter({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string | undefined) => void }) {
  return (
    <Labelled label={label}>
      {(id) => <input id={id} type="date" className="input" dir="ltr" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />}
    </Labelled>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="hp-filterbar">{children}</div>;
}
