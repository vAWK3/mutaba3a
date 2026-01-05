import type { TxStatus } from '../../types';
import { cn } from '../../lib/utils';

type StatusValue = TxStatus | 'overdue' | undefined;

interface StatusSegmentProps {
  value: StatusValue;
  onChange: (value: StatusValue) => void;
}

export function StatusSegment({ value, onChange }: StatusSegmentProps) {
  const options: { value: StatusValue; label: string }[] = [
    { value: undefined, label: 'All' },
    { value: 'paid', label: 'Paid' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue' },
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
