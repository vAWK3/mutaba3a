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
 *
 * MUT-175 (DR23, DR30): with no `onSelect` the rows are plain (Reports' lists),
 * and each row may carry an end-aligned `meta` ("typically 14 days") and a
 * muted second line (`detail`, the profile name in All profiles).
 */

export interface CategoryBarsProps {
  rows: CategoryRow[];
  currency: Currency;
  selected?: string;
  onSelect?: (key: string | undefined) => void;
  reducedMotion: boolean;
  meta?: (row: CategoryRow) => string | null;
  detail?: (row: CategoryRow) => string | null;
}

export function CategoryBars({ rows, currency, selected, onSelect, reducedMotion, meta, detail }: CategoryBarsProps) {
  return (
    <div className="hp-catbars">
      {rows.map((row) => (
        <CategoryBar
          key={row.key}
          row={row}
          currency={currency}
          pressed={row.key === selected}
          onToggle={onSelect && (() => onSelect(row.key === selected ? undefined : row.key))}
          reducedMotion={reducedMotion}
          meta={meta?.(row) ?? null}
          detail={detail?.(row) ?? null}
        />
      ))}
    </div>
  );
}

const PERCENT = 100;

interface CategoryBarProps {
  row: CategoryRow;
  currency: Currency;
  pressed: boolean;
  onToggle: (() => void) | undefined;
  reducedMotion: boolean;
  meta: string | null;
  detail: string | null;
}

function CategoryBar({ row, currency, pressed, onToggle, reducedMotion, meta, detail }: CategoryBarProps) {
  const fill = useRef<HTMLSpanElement>(null);
  useSpringScale(fill, row.share / PERCENT, 'x', reducedMotion);
  const className = `hp-catbar ${onToggle ? 'press' : 'hp-catbar-plain'} ${row.key === UNCATEGORIZED ? 'hp-catbar-none' : ''}`;
  const content = (
    <>
      <span className="hp-catbar-name">
        {row.name}
        {detail && <span className="hp-catbar-detail">{detail}</span>}
      </span>
      <span className="hp-catbar-amount">
        <DecimalAmount value={row.total} currency={currency} /> · {row.share}%{meta && <span className="hp-catbar-meta">{meta}</span>}
      </span>
      <span className="hp-catbar-track" aria-hidden="true">
        <span ref={fill} className="hp-catbar-fill" />
      </span>
    </>
  );
  if (!onToggle) return <div className={className}>{content}</div>;
  return (
    <button type="button" className={className} aria-pressed={pressed} onClick={onToggle}>
      {content}
    </button>
  );
}
