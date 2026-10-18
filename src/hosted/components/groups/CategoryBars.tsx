import { useRef } from 'react';
import type { Currency } from '../../api/client';
import type { CategoryRow } from '../../data/expenseGroups';
import { DecimalAmount } from '../../format/DecimalAmount';
import { UNCATEGORIZED } from '../../data/expenseGroups';
import { useSpringScale } from './useSpringScale';

/**
 * Where a group's money went, per category in the selected currency (MUT-268
 * 13A, 23A): each row is a toggle that filters the member list to it;
 * Uncategorized is last and muted. Widths morph from where they are (craft 3).
 */

export interface CategoryBarsProps {
  rows: CategoryRow[];
  currency: Currency;
  selected?: string;
  onSelect: (key: string | undefined) => void;
  reducedMotion: boolean;
}

export function CategoryBars({ rows, currency, selected, onSelect, reducedMotion }: CategoryBarsProps) {
  return (
    <div className="hp-catbars">
      {rows.map((row) => (
        <CategoryBar key={row.key} row={row} currency={currency} pressed={row.key === selected} onToggle={() => onSelect(row.key === selected ? undefined : row.key)} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}

const PERCENT = 100;

function CategoryBar({ row, currency, pressed, onToggle, reducedMotion }: { row: CategoryRow; currency: Currency; pressed: boolean; onToggle: () => void; reducedMotion: boolean }) {
  const fill = useRef<HTMLSpanElement>(null);
  useSpringScale(fill, row.share / PERCENT, 'x', reducedMotion);
  return (
    <button type="button" className={`hp-catbar press ${row.key === UNCATEGORIZED ? 'hp-catbar-none' : ''}`} aria-pressed={pressed} onClick={onToggle}>
      <span className="hp-catbar-name">{row.name}</span>
      <span className="hp-catbar-amount">
        <DecimalAmount value={row.total} currency={currency} /> · {row.share}%
      </span>
      <span className="hp-catbar-track" aria-hidden="true">
        <span ref={fill} className="hp-catbar-fill" />
      </span>
    </button>
  );
}
