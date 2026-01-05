import { cn } from '../../lib/utils';

interface InlineStat {
  label: string;
  value: string;
  color?: 'positive' | 'negative' | 'warning' | 'neutral';
}

interface InlineStatsProps {
  stats: InlineStat[];
  className?: string;
}

/**
 * Displays a row of inline statistics.
 * Used in project and client detail page headers.
 */
export function InlineStats({ stats, className }: InlineStatsProps) {
  return (
    <div className={cn('inline-stats', className)}>
      {stats.map((stat, index) => (
        <div key={index} className="inline-stat">
          <span className="inline-stat-label">{stat.label}</span>
          <span
            className={cn(
              'inline-stat-value',
              stat.color === 'positive' && 'amount-positive',
              stat.color === 'negative' && 'amount-negative',
              stat.color === 'warning' && 'amount-warning'
            )}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}
