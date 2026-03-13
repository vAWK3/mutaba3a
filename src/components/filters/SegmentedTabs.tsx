/**
 * SegmentedTabs - Generic tabbed segment control
 *
 * A reusable component for status/type/category filtering with tab-style buttons.
 * Supports optional counts for each tab.
 */

import { cn } from '../../lib/utils';

export interface SegmentOption<T = string> {
  value: T;
  label: string;
  count?: number;
}

export interface SegmentedTabsProps<T = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedTabs<T = string>({
  options,
  value,
  onChange,
  className,
}: SegmentedTabsProps<T>) {
  return (
    <div className={cn('segment-tabs', className)} role="tablist">
      {options.map((option, index) => {
        const isSelected = option.value === value;
        return (
          <button
            key={String(option.value) || `option-${index}`}
            role="tab"
            aria-selected={isSelected}
            className={cn('segment-tab', isSelected && 'segment-tab-active')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="segment-tab-count">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
