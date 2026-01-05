import type { TxKind } from '../../types';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';

type TypeValue = TxKind | 'receivable' | undefined;

interface TypeSegmentProps {
  value: TypeValue;
  onChange: (value: TypeValue) => void;
}

export function TypeSegment({ value, onChange }: TypeSegmentProps) {
  const t = useT();

  const options: { value: TypeValue; labelKey: string }[] = [
    { value: undefined, labelKey: 'filters.type.all' },
    { value: 'income', labelKey: 'filters.type.income' },
    { value: 'receivable', labelKey: 'filters.type.receivable' },
    { value: 'expense', labelKey: 'filters.type.expense' },
  ];

  return (
    <div className="segment-control">
      {options.map((option) => (
        <button
          key={option.labelKey}
          className={cn('segment-button', value === option.value && 'active')}
          onClick={() => onChange(option.value)}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );
}
