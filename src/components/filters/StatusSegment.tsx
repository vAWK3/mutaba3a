import type { TxStatus } from '../../types';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';

type StatusValue = TxStatus | 'overdue' | undefined;

interface StatusSegmentProps {
  value: StatusValue;
  onChange: (value: StatusValue) => void;
}

export function StatusSegment({ value, onChange }: StatusSegmentProps) {
  const t = useT();

  const options: { value: StatusValue; labelKey: string }[] = [
    { value: undefined, labelKey: 'filters.status.all' },
    { value: 'paid', labelKey: 'filters.status.paid' },
    { value: 'unpaid', labelKey: 'filters.status.unpaid' },
    { value: 'overdue', labelKey: 'filters.status.overdue' },
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
