import type { TxKind } from '../../types';
import { cn } from '../../lib/utils';

type TypeValue = TxKind | 'receivable' | undefined;

interface TypeSegmentProps {
  value: TypeValue;
  onChange: (value: TypeValue) => void;
}

export function TypeSegment({ value, onChange }: TypeSegmentProps) {
  const options: { value: TypeValue; label: string }[] = [
    { value: undefined, label: 'All' },
    { value: 'income', label: 'Income' },
    { value: 'receivable', label: 'Receivable' },
    { value: 'expense', label: 'Expense' },
  ];

  return (
    <div className="segment-control">
      {options.map((option) => (
        <button
          key={option.label}
          className={cn('segment-button', value === option.value && 'active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
